"""
HAMMA API - FastAPI Application

High-performance REST API for SPK optimization predictions.
Responds in <5ms, scales to 100+ requests/sec.

Creator: Onazi Treasure (OJ)
"""

import time
import asyncio
from typing import Optional, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from .request_schemas import (
    PredictionRequest,
    BatchPredictionRequest,
    PredictionResponse,
    BatchPredictionResponse,
    HealthResponse,
    ProfileResponse,
)


# ============================================================================
# HAMMA EXTREME Request/Response Schemas
# ============================================================================

class LearningFeedbackRequest(BaseModel):
    """Feedback for online learning"""
    entropy: float
    chunk_size: int
    signature: str
    histogram_nonzero: int
    predicted_ratio: float
    predicted_mode: str
    predicted_refinement: int
    actual_ratio: float
    actual_mode_effective: str
    refinement_benefit: float
    memory_pressure: float
    throughput_mbps: float
    had_error: bool


class ExtremeTargetRequest(BaseModel):
    """Request for extreme compression settings"""
    input_size_bytes: int
    estimated_entropy: float = 4.0
    memory_available_mb: int = 1024
    time_budget_seconds: Optional[float] = None


class ExtremeRecommendRequest(BaseModel):
    """Request for chunk-level recommendations"""
    chunk_entropy: float
    chunk_size: int
    signature: str
    current_ratio: float
    elapsed_time: float
    memory_usage_mb: int


class ExtremeSettingsResponse(BaseModel):
    """Extreme compression settings response"""
    desired_refinement_depth: int
    chunk_mode_bias: str
    compression_goal: Dict[str, Any]
    activation_threshold: float
    risk_tolerance: float


class LearningStatsResponse(BaseModel):
    """Learning statistics response"""
    total_samples: int
    is_warmed_up: bool
    stability_score: float
    avg_error: float
    has_persisted_state: bool

# Import models (lazy loaded)
_models_loaded = False
_entropy_predictor = None
_redundancy_predictor = None
_mode_selector = None
_stability_model = None

# HAMMA EXTREME components (lazy loaded)
_extreme_loaded = False
_model_state = None
_online_trainer = None
_extreme_controller = None
_stability_engine = None
_state_persistence = None

# Stats tracking
_start_time = time.time()
_request_count = 0
_total_latency_ms = 0.0


async def load_models():
    """Lazy load ML models"""
    global _models_loaded, _entropy_predictor, _redundancy_predictor
    global _mode_selector, _stability_model
    
    if _models_loaded:
        return
    
    from ..models.entropy_predictor import EntropyPredictor
    from ..models.redundancy_model import RedundancyPredictor
    from ..models.mode_selector import ModeSelector
    from ..models.stability_model import StabilityModel
    
    _entropy_predictor = EntropyPredictor()
    _redundancy_predictor = RedundancyPredictor()
    _mode_selector = ModeSelector()
    _stability_model = StabilityModel()
    
    _models_loaded = True


async def load_extreme():
    """Lazy load HAMMA EXTREME components"""
    global _extreme_loaded, _model_state, _online_trainer
    global _extreme_controller, _stability_engine, _state_persistence
    
    if _extreme_loaded:
        return
    
    from ..self_learning.model_state import ModelState
    from ..self_learning.trainer import OnlineTrainer
    from ..self_learning.extreme_ratio import ExtremeRatioController
    from ..self_learning.stability_engine import StabilityEngine
    from ..self_learning.persistence import StatePersistence
    
    # Initialize persistence first
    _state_persistence = StatePersistence()
    
    # Try to load existing state
    saved_states = _state_persistence.load_all()
    
    if saved_states.get('model_state'):
        _model_state = ModelState.from_dict(saved_states['model_state'])
    else:
        _model_state = ModelState()
    
    if saved_states.get('trainer'):
        _online_trainer = OnlineTrainer.from_dict(saved_states['trainer'], _model_state)
    else:
        _online_trainer = OnlineTrainer(_model_state)
    
    if saved_states.get('extreme_ratio'):
        _extreme_controller = ExtremeRatioController.from_dict(
            saved_states['extreme_ratio'], _model_state
        )
    else:
        _extreme_controller = ExtremeRatioController(_model_state)
    
    if saved_states.get('stability_engine'):
        _stability_engine = StabilityEngine.from_dict(saved_states['stability_engine'])
    else:
        _stability_engine = StabilityEngine()
    
    _extreme_loaded = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - load models on startup"""
    await load_models()
    await load_extreme()  # Also load EXTREME components on startup
    yield
    # Save state on shutdown
    if _extreme_loaded and _state_persistence:
        try:
            _state_persistence.save_all(
                model_state=_model_state,
                trainer=_online_trainer,
                extreme_ratio=_extreme_controller,
                stability_engine=_stability_engine,
            )
        except Exception:
            pass  # Don't crash on shutdown


# Create FastAPI app
app = FastAPI(
    title="HAMMA - AI Acceleration Engine",
    description="Intelligent compression optimization for SPK with EXTREME self-learning",
    version="2.0.0",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

# CORS for browser access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Prediction Endpoints
# ============================================================================

@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest) -> PredictionResponse:
    """
    Single chunk prediction endpoint.
    
    Receives metadata only, returns optimization instructions.
    Target latency: <5ms
    """
    global _request_count, _total_latency_ms
    
    start = time.perf_counter()
    
    if not _models_loaded:
        await load_models()
    
    try:
        # Run predictions in parallel
        chunk = request.chunk
        device = request.device_profile
        history = request.history
        
        # Entropy prediction
        expected_ratio = _entropy_predictor.predict(
            entropy=chunk.entropy_score,
            chunk_size=chunk.chunk_size,
            histogram=chunk.histogram,
        )
        
        # Redundancy check
        redundancy_cluster = _redundancy_predictor.predict(
            signature=chunk.redundancy_signature,
            chunk_index=chunk.chunk_index,
        )
        
        # Mode selection
        chunk_mode, refinement_level = _mode_selector.predict(
            entropy=chunk.entropy_score,
            chunk_size=chunk.chunk_size,
            expected_ratio=expected_ratio,
            is_redundant=redundancy_cluster is not None,
            device_profile=device,
            history=history,
        )
        
        # Stability assessment
        stability_flag, memory_target_obj, lane_boost = _stability_model.predict(
            device_profile=device,
            worker_stats=request.worker_stats,
            chunk_size=chunk.chunk_size,
        )
        
        # Convert dataclass to dict for Pydantic
        memory_target = {
            "chunk_size": memory_target_obj.chunk_size,
            "concurrency": memory_target_obj.concurrency,
        }
        
        # Anomaly detection
        anomaly_detected = _detect_anomaly(chunk, request.worker_stats)
        
        # Build response
        response = PredictionResponse(
            chunk_mode=chunk_mode,
            refinement_level=refinement_level,
            lane_boost=lane_boost,
            expected_ratio=expected_ratio,
            stability_flag=stability_flag,
            memory_target=memory_target,
            anomaly_detected=anomaly_detected,
            confidence=0.85,
            redundancy_cluster=redundancy_cluster,
        )
        
        # Track stats
        elapsed_ms = (time.perf_counter() - start) * 1000
        _request_count += 1
        _total_latency_ms += elapsed_ms
        
        return response
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/predict/batch", response_model=BatchPredictionResponse)
async def predict_batch(request: BatchPredictionRequest) -> BatchPredictionResponse:
    """
    Batch prediction for multiple chunks.
    
    Optimized for high throughput on large datasets.
    """
    global _request_count, _total_latency_ms
    
    start = time.perf_counter()
    
    if not _models_loaded:
        await load_models()
    
    predictions = []
    
    for i, chunk in enumerate(request.chunks):
        # Create single request
        single_req = PredictionRequest(
            chunk=chunk,
            worker_stats=request.worker_stats,
            device_profile=request.device_profile,
            partition_info=request.partition_info,
            history=request.history,
            batch_size=len(request.chunks),
            batch_index=i,
        )
        
        # Predict
        pred = await predict(single_req)
        predictions.append(pred)
    
    # Batch stats
    elapsed_ms = (time.perf_counter() - start) * 1000
    
    return BatchPredictionResponse(
        predictions=predictions,
        batch_stats={
            "total_chunks": len(request.chunks),
            "total_time_ms": elapsed_ms,
            "avg_time_per_chunk_ms": elapsed_ms / len(request.chunks) if request.chunks else 0,
        },
    )


# ============================================================================
# WebSocket for Real-time Streaming
# ============================================================================

@app.websocket("/ws/predict")
async def websocket_predict(websocket: WebSocket):
    """
    WebSocket endpoint for real-time optimization tuning.
    
    Accepts streaming metadata, returns continuous predictions.
    """
    await websocket.accept()
    
    if not _models_loaded:
        await load_models()
    
    try:
        while True:
            # Receive metadata
            data = await websocket.receive_json()
            
            # Parse and predict
            request = PredictionRequest(**data)
            response = await predict(request)
            
            # Send response
            await websocket.send_json(response.model_dump())
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.close(code=1011, reason=str(e))


# ============================================================================
# Health & Monitoring
# ============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check endpoint"""
    uptime = time.time() - _start_time
    avg_latency = _total_latency_ms / _request_count if _request_count > 0 else 0
    
    models = []
    if _entropy_predictor:
        models.append("entropy_predictor")
    if _redundancy_predictor:
        models.append("redundancy_predictor")
    if _mode_selector:
        models.append("mode_selector")
    if _stability_model:
        models.append("stability_model")
    
    status = "healthy"
    if avg_latency > 10:
        status = "degraded"
    if avg_latency > 50:
        status = "unhealthy"
    
    return HealthResponse(
        status=status,
        version="1.0.0",
        uptime_seconds=uptime,
        requests_processed=_request_count,
        avg_latency_ms=avg_latency,
        models_loaded=models,
    )


@app.get("/profile", response_model=ProfileResponse)
async def get_profile() -> ProfileResponse:
    """Profiling endpoint for performance monitoring"""
    import os
    
    # Get process memory
    try:
        import psutil
        process = psutil.Process(os.getpid())
        memory_mb = process.memory_info().rss / 1024 / 1024
        cpu_percent = process.cpu_percent()
    except ImportError:
        memory_mb = 0
        cpu_percent = 0
    
    return ProfileResponse(
        cpu_percent=cpu_percent,
        memory_mb=memory_mb,
        active_requests=0,  # Would need proper tracking
        model_stats={
            "entropy_predictor": _entropy_predictor.get_stats() if _entropy_predictor else {},
            "redundancy_predictor": _redundancy_predictor.get_stats() if _redundancy_predictor else {},
            "mode_selector": _mode_selector.get_stats() if _mode_selector else {},
            "stability_model": _stability_model.get_stats() if _stability_model else {},
        },
    )


# ============================================================================
# Helper Functions
# ============================================================================

def _detect_anomaly(chunk, worker_stats) -> bool:
    """Detect anomalous chunk behavior"""
    # Check for anomalies
    anomalies = []
    
    # Entropy anomaly (very high or very low)
    if chunk.entropy_score < 0.5 or chunk.entropy_score > 7.9:
        anomalies.append("entropy")
    
    # Size anomaly
    if chunk.chunk_size < 1024:
        anomalies.append("tiny_chunk")
    
    # Compression anomaly
    if chunk.compressed_size and chunk.compressed_size > chunk.chunk_size * 1.1:
        anomalies.append("expansion")
    
    # Worker timing anomaly
    if worker_stats and worker_stats.last_chunk_time_ms > worker_stats.avg_chunk_time_ms * 3:
        anomalies.append("slow_worker")
    
    return len(anomalies) > 0


# ============================================================================
# HAMMA EXTREME Endpoints - Self-Adaptive Learning
# ============================================================================

@app.post("/extreme/feedback")
async def learning_feedback(request: LearningFeedbackRequest):
    """
    Submit learning feedback from compression results.
    
    The model learns from metadata ONLY - no raw bytes or content.
    This enables continuous improvement of compression predictions.
    """
    if not _extreme_loaded:
        await load_extreme()
    
    try:
        # Perform training step
        _online_trainer.train_step(
            entropy=request.entropy,
            chunk_size=request.chunk_size,
            signature=request.signature,
            histogram_nonzero=request.histogram_nonzero,
            predicted_ratio=request.predicted_ratio,
            predicted_mode=request.predicted_mode,
            predicted_refinement=request.predicted_refinement,
            actual_ratio=request.actual_ratio,
            actual_mode_effective=request.actual_mode_effective,
            refinement_benefit=request.refinement_benefit,
            memory_pressure=request.memory_pressure,
            throughput_mbps=request.throughput_mbps,
            had_error=request.had_error,
        )
        
        # Record in stability engine
        prediction_error = abs(request.predicted_ratio - request.actual_ratio)
        _stability_engine.record_training_step(
            training_error=prediction_error,
            pattern_signature=request.signature,
        )
        
        return {"status": "learned", "samples": _online_trainer.total_samples}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extreme/target", response_model=ExtremeSettingsResponse)
async def extreme_target(request: ExtremeTargetRequest) -> ExtremeSettingsResponse:
    """
    Generate extreme compression settings for a dataset.
    
    Targets theoretical compression limits for redundant data.
    Goal: 10TB → ~1GB when redundancies permit.
    """
    if not _extreme_loaded:
        await load_extreme()
    
    try:
        settings = _extreme_controller.target(
            input_size_bytes=request.input_size_bytes,
            estimated_entropy=request.estimated_entropy,
            memory_available_mb=request.memory_available_mb,
            time_budget_seconds=request.time_budget_seconds,
        )
        
        return ExtremeSettingsResponse(
            desired_refinement_depth=settings.desired_refinement_depth,
            chunk_mode_bias=settings.chunk_mode_bias,
            compression_goal={
                "target_ratio": settings.compression_goal.target_ratio,
                "min_ratio": settings.compression_goal.min_acceptable_ratio,
                "max_ratio": settings.compression_goal.max_acceptable_ratio,
            },
            activation_threshold=settings.activation_threshold,
            risk_tolerance=settings.risk_tolerance,
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extreme/recommend")
async def extreme_recommend(request: ExtremeRecommendRequest):
    """
    Get chunk-level recommendations for extreme compression.
    
    Returns dynamic adjustments based on current state and learned patterns.
    """
    if not _extreme_loaded:
        await load_extreme()
    
    try:
        recommendations = _extreme_controller.recommend(
            chunk_entropy=request.chunk_entropy,
            chunk_size=request.chunk_size,
            signature=request.signature,
            current_ratio=request.current_ratio,
            elapsed_time=request.elapsed_time,
            memory_usage_mb=request.memory_usage_mb,
        )
        
        # Get learned adjustments from trainer
        adjustments = _online_trainer.get_prediction_adjustments(
            entropy=request.chunk_entropy,
            chunk_size=request.chunk_size,
            histogram_nonzero=128,  # Default estimate
            signature=request.signature,
        )
        
        return {
            **recommendations,
            "learned_adjustments": adjustments,
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/extreme/stats", response_model=LearningStatsResponse)
async def extreme_stats() -> LearningStatsResponse:
    """
    Get HAMMA EXTREME learning statistics.
    """
    if not _extreme_loaded:
        await load_extreme()
    
    trainer_stats = _online_trainer.get_training_stats()
    stability_report = _stability_engine.check_stability()
    
    return LearningStatsResponse(
        total_samples=trainer_stats['total_samples'],
        is_warmed_up=trainer_stats['is_warmed_up'],
        stability_score=stability_report['stability_score'],
        avg_error=trainer_stats['avg_error'],
        has_persisted_state=_state_persistence.has_state(),
    )


@app.get("/extreme/progress")
async def extreme_progress():
    """
    Get compression progress and dataset analysis.
    """
    if not _extreme_loaded:
        await load_extreme()
    
    return _extreme_controller.get_progress()


@app.post("/extreme/save")
async def extreme_save():
    """
    Save all learned state to disk.
    
    Persists ONLY:
    - Learned model parameters
    - Statistical distributions
    - Metadata signatures (NOT content)
    """
    if not _extreme_loaded:
        await load_extreme()
    
    try:
        saved = _state_persistence.save_all(
            model_state=_model_state,
            trainer=_online_trainer,
            extreme_ratio=_extreme_controller,
            stability_engine=_stability_engine,
        )
        
        return {"status": "saved", "paths": saved}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extreme/reset")
async def extreme_reset():
    """
    Reset all learned state.
    
    Use with caution - loses all learning progress.
    """
    if not _extreme_loaded:
        await load_extreme()
    
    from ..self_learning.trainer import OnlineTrainer
    
    _model_state.reset()
    _extreme_controller.reset()
    _stability_engine.reset()
    
    # Clear persistence
    _state_persistence.clear_all()
    
    # Reinitialize trainer
    global _online_trainer
    _online_trainer = OnlineTrainer(_model_state)
    
    return {"status": "reset", "message": "All learning state cleared"}


@app.get("/extreme/stability")
async def extreme_stability():
    """
    Get detailed stability report.
    """
    if not _extreme_loaded:
        await load_extreme()
    
    return _stability_engine.check_stability()
