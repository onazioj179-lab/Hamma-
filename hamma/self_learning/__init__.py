"""
HAMMA EXTREME Self-Learning Module

Self-adaptive learning layer for SPK compression optimization.
Learns from structural metadata (NOT file contents) to push
compression ratios toward theoretical limits.

Creator: Onazi Treasure (OJ)
"""

from .model_state import (
    ModelState,
    EntropyDistribution,
    RedundancyFingerprint,
    CompressionCurve,
    HardwareCapability,
)
from .trainer import (
    OnlineTrainer,
    IncrementalGradient,
    AdaptiveModelTuner,
)
from .persistence import (
    StatePersistence,
    CheckpointManager,
    StateSerializer,
)
from .extreme_ratio import (
    ExtremeRatioController,
    RedundancyAnalyzer,
    CompressionGoal,
    ExtremeSettings,
)
from .stability_engine import (
    StabilityEngine,
    ParameterSmoother,
    OverfitDetector,
    OscillationDamper,
)

__all__ = [
    # Model State
    'ModelState',
    'EntropyDistribution',
    'RedundancyFingerprint',
    'CompressionCurve',
    'HardwareCapability',
    # Trainer
    'OnlineTrainer',
    'IncrementalGradient',
    'AdaptiveModelTuner',
    # Persistence
    'StatePersistence',
    'CheckpointManager',
    'StateSerializer',
    # Extreme Ratio
    'ExtremeRatioController',
    'RedundancyAnalyzer',
    'CompressionGoal',
    'ExtremeSettings',
    # Stability
    'StabilityEngine',
    'ParameterSmoother',
    'OverfitDetector',
    'OscillationDamper',
]
