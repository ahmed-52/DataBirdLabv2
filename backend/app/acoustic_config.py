# ---------------------------------------------------------------------------
# Acoustic pipeline confidence configuration
# ---------------------------------------------------------------------------
# This config is used by both the BirdNET pipeline (frontend uploads)
# and the manual ingestion script.
#
# To add a species-specific threshold, add an entry to
# SPECIES_CONFIDENCE_OVERRIDES with the exact BirdNET common name.
# ---------------------------------------------------------------------------

# Minimum confidence sent to BirdNET analysis.
# Set low to capture all potential detections before post-filtering.
ANALYSIS_MIN_CONFIDENCE = 0.01

DEFAULT_SAVE_CONFIDENCE = 0.25

# Species-specific confidence overrides.
# Species listed here use their own threshold instead of DEFAULT_SAVE_CONFIDENCE.



SPECIES_CONFIDENCE_OVERRIDES = {
    "Asian Openbill": 0.01,
    # "Painted Stork": 0.05,
    # "Greater Adjutant": 0.10,
}
