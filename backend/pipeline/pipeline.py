from abc import ABC, abstractmethod
from typing import Any, Dict

# from .drone.drone import DronePipeline


class Pipeline(ABC):
    def __init__(self,  config: Dict[str, Any]):
        self.config = config

    @abstractmethod
    def ingest(self, source: Any) -> Any:
        """Fetch or load raw data."""
        pass

    @abstractmethod
    def transform(self, data: Any) -> Any:
        """Clean, pre-process, or format the data."""
        pass

    @abstractmethod
    def run_inference(self, processed_data: Any) -> Any:
        """Apply models or logic to the data."""
        pass

    @abstractmethod
    def save(self, results: Any) -> None:
        """Persist results to a database or storage."""
        pass


class PipelineManager:
    def __init__(self, pipeline_type: str):
        if pipeline_type == "drone":
            from .drone.drone import DronePipeline
            self.pipeline = DronePipeline()
        elif pipeline_type == "birdnet":
            from .birdnet.birdnet import BirdNetPipeline
            self.pipeline = BirdNetPipeline()
        else:
            raise ValueError(f"Unknown pipeline type: {pipeline_type}")

    def run_survey_processing(self, survey_id: int, input_path: str, output_dir: str = None, aru_id: int = None):
        assets_metadata = self.pipeline.transform(
            survey_id=survey_id,
            input_path=input_path,
            output_dir=output_dir,
            aru_id=aru_id
        )
        self.pipeline.save(survey_id, assets_metadata)

        self.pipeline.run_inference(survey_id=survey_id)