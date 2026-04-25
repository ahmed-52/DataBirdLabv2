#!/usr/bin/env python
"""
Cloud Run Job entrypoint for pipeline execution.

Invoked by: gcloud run jobs execute pipeline-job --args=...
"""
import os
import sys
import argparse
import logging
from sqlmodel import Session
from app.database import engine
from app.models import Survey, Colony

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--survey-id", type=int, required=True)
    parser.add_argument("--pipeline-type", choices=["drone", "birdnet"], required=True)
    parser.add_argument("--input-path", required=True, help="GCS path to staged input file")
    parser.add_argument("--aru-id", type=int, default=None)
    args = parser.parse_args()

    log.info("starting pipeline job", extra={"survey_id": args.survey_id, "type": args.pipeline_type})

    with Session(engine) as session:
        survey = session.get(Survey, args.survey_id)
        if not survey:
            log.error(f"Survey {args.survey_id} not found")
            sys.exit(1)
        survey.status = "processing"
        session.add(survey)
        session.commit()

    try:
        from pipeline import PipelineManager
        manager = PipelineManager(pipeline_type=args.pipeline_type)
        manager.run_survey_processing(
            survey_id=args.survey_id,
            input_path=args.input_path,
            output_dir=None,
            aru_id=args.aru_id,
        )

        with Session(engine) as session:
            survey = session.get(Survey, args.survey_id)
            survey.status = "completed"
            session.add(survey); session.commit()
        log.info("pipeline completed", extra={"survey_id": args.survey_id})
    except Exception as e:
        log.exception("pipeline failed")
        with Session(engine) as session:
            survey = session.get(Survey, args.survey_id)
            survey.status = "failed"
            survey.error_message = str(e)
            session.add(survey); session.commit()
        sys.exit(2)


if __name__ == "__main__":
    main()
