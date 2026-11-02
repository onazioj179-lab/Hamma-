"""
HAMMA EXTREME State Persistence

Lightweight state serialization without storing raw data.
Maintains model continuity across sessions.

Creator: Onazi Treasure (OJ)
"""

import json
import gzip
import time
import os
from typing import Dict, Optional, Any
from dataclasses import dataclass, field
from pathlib import Path
import hashlib


# ============================================================================
# State Serializer
# ============================================================================

class StateSerializer:
    """
    Serializes model state to/from JSON-compatible format.
    Handles numpy arrays, nested dataclasses, etc.
    """
    
    @staticmethod
    def serialize(obj: Any) -> Any:
        """Convert object to JSON-serializable format."""
        if obj is None:
            return None
        
        # Handle numpy arrays
        if hasattr(obj, 'tolist'):
            return obj.tolist()
        
        # Handle dataclasses
        if hasattr(obj, '__dataclass_fields__'):
            return {
                k: StateSerializer.serialize(getattr(obj, k))
                for k in obj.__dataclass_fields__
            }
        
        # Handle dicts
        if isinstance(obj, dict):
            return {
                str(k): StateSerializer.serialize(v)
                for k, v in obj.items()
            }
        
        # Handle lists, tuples
        if isinstance(obj, (list, tuple)):
            return [StateSerializer.serialize(x) for x in obj]
        
        # Handle objects with to_dict method
        if hasattr(obj, 'to_dict'):
            return obj.to_dict()
        
        # Primitive types
        return obj
    
    @staticmethod
    def deserialize(data: Any, target_type: Any = None) -> Any:
        """Convert JSON data back to objects."""
        # Simply return data - complex deserialization handled by from_dict methods
        return data


# ============================================================================
# Checkpoint Manager
# ============================================================================

class CheckpointManager:
    """
    Manages checkpoint files for state recovery.
    
    Features:
    - Atomic writes (temp file + rename)
    - Compression for size reduction
    - Version tracking
    - Automatic cleanup of old checkpoints
    """
    
    VERSION = "1.0.0"
    MAX_CHECKPOINTS = 5
    
    def __init__(self, checkpoint_dir: str = ".hamma_state"):
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
    
    def _get_checkpoint_path(self, name: str, timestamp: Optional[float] = None) -> Path:
        """Get path for checkpoint file."""
        if timestamp:
            ts_str = f"_{int(timestamp)}"
        else:
            ts_str = ""
        return self.checkpoint_dir / f"{name}{ts_str}.hamma.gz"
    
    def _compute_checksum(self, data: bytes) -> str:
        """Compute checksum for data integrity."""
        return hashlib.sha256(data).hexdigest()[:16]
    
    def save(
        self,
        name: str,
        state_dict: Dict[str, Any],
        compress: bool = True,
        versioned: bool = True,
    ) -> str:
        """
        Save checkpoint.
        
        Args:
            name: Checkpoint name
            state_dict: State to save
            compress: Whether to gzip compress
            versioned: Whether to create versioned backup
            
        Returns:
            Path to saved checkpoint
        """
        timestamp = time.time()
        
        # Add metadata
        checkpoint = {
            'version': self.VERSION,
            'timestamp': timestamp,
            'name': name,
            'state': StateSerializer.serialize(state_dict),
        }
        
        # Serialize to JSON
        json_data = json.dumps(checkpoint, indent=2, default=str)
        data = json_data.encode('utf-8')
        
        # Add checksum
        checkpoint['checksum'] = self._compute_checksum(data)
        json_data = json.dumps(checkpoint, indent=2, default=str)
        data = json_data.encode('utf-8')
        
        # Compress if requested
        if compress:
            data = gzip.compress(data)
        
        # Get path
        main_path = self._get_checkpoint_path(name)
        
        # Atomic write: write to temp, then rename
        temp_path = main_path.with_suffix('.tmp')
        temp_path.write_bytes(data)
        
        # If versioned, keep old checkpoint as backup
        if versioned and main_path.exists():
            backup_path = self._get_checkpoint_path(name, timestamp)
            # On Windows, need to remove target first if it exists
            if backup_path.exists():
                backup_path.unlink()
            main_path.rename(backup_path)
            self._cleanup_old_checkpoints(name)
        
        # Remove existing main path on Windows before rename
        if main_path.exists():
            main_path.unlink()
        
        # Rename temp to final
        temp_path.rename(main_path)
        
        return str(main_path)
    
    def load(self, name: str) -> Optional[Dict[str, Any]]:
        """
        Load checkpoint.
        
        Returns None if checkpoint doesn't exist or is corrupted.
        """
        path = self._get_checkpoint_path(name)
        
        if not path.exists():
            return None
        
        try:
            data = path.read_bytes()
            
            # Decompress if gzipped
            if data[:2] == b'\x1f\x8b':  # gzip magic number
                data = gzip.decompress(data)
            
            checkpoint = json.loads(data.decode('utf-8'))
            
            # Verify version compatibility
            checkpoint_version = checkpoint.get('version', '0.0.0')
            if not self._is_compatible_version(checkpoint_version):
                return None
            
            return checkpoint.get('state', {})
        
        except Exception:
            # Corrupted checkpoint
            return None
    
    def exists(self, name: str) -> bool:
        """Check if checkpoint exists."""
        return self._get_checkpoint_path(name).exists()
    
    def delete(self, name: str):
        """Delete checkpoint and backups."""
        main_path = self._get_checkpoint_path(name)
        if main_path.exists():
            main_path.unlink()
        
        # Delete backups
        for backup in self.checkpoint_dir.glob(f"{name}_*.hamma.gz"):
            backup.unlink()
    
    def list_checkpoints(self) -> Dict[str, Dict[str, Any]]:
        """List all checkpoints with metadata."""
        checkpoints = {}
        
        for path in self.checkpoint_dir.glob("*.hamma.gz"):
            name = path.stem.split('_')[0]
            
            try:
                data = path.read_bytes()
                if data[:2] == b'\x1f\x8b':
                    data = gzip.decompress(data)
                checkpoint = json.loads(data.decode('utf-8'))
                
                checkpoints[path.name] = {
                    'name': name,
                    'version': checkpoint.get('version'),
                    'timestamp': checkpoint.get('timestamp'),
                    'size_bytes': path.stat().st_size,
                }
            except Exception:
                checkpoints[path.name] = {'name': name, 'corrupted': True}
        
        return checkpoints
    
    def _cleanup_old_checkpoints(self, name: str):
        """Remove old versioned checkpoints beyond MAX_CHECKPOINTS."""
        backups = sorted(
            self.checkpoint_dir.glob(f"{name}_*.hamma.gz"),
            key=lambda p: p.stat().st_mtime,
            reverse=True
        )
        
        # Keep only MAX_CHECKPOINTS-1 backups (excluding main)
        for old in backups[self.MAX_CHECKPOINTS - 1:]:
            old.unlink()
    
    def _is_compatible_version(self, version: str) -> bool:
        """Check if checkpoint version is compatible."""
        # Simple major version check
        major = version.split('.')[0]
        current_major = self.VERSION.split('.')[0]
        return major == current_major


# ============================================================================
# State Persistence - Main Interface
# ============================================================================

class StatePersistence:
    """
    High-level interface for HAMMA EXTREME state persistence.
    
    Manages:
    - ModelState persistence
    - OnlineTrainer persistence
    - ExtremeRatioController persistence
    - StabilityEngine persistence
    
    All persisted state contains ONLY:
    - Learned parameters (weights, biases)
    - Statistical distributions
    - Metadata signatures (not content)
    
    NEVER persists:
    - Raw file content
    - User data
    - Actual byte sequences
    """
    
    DEFAULT_DIR = ".hamma_state"
    
    def __init__(self, state_dir: Optional[str] = None):
        self.state_dir = state_dir or self.DEFAULT_DIR
        self.checkpoint_mgr = CheckpointManager(self.state_dir)
        
        # Track what's loaded
        self._loaded_components: Dict[str, Any] = {}
    
    def save_all(
        self,
        model_state: Optional[Any] = None,
        trainer: Optional[Any] = None,
        extreme_ratio: Optional[Any] = None,
        stability_engine: Optional[Any] = None,
    ) -> Dict[str, str]:
        """
        Save all component states.
        
        Returns dict of component name -> checkpoint path.
        """
        saved = {}
        
        if model_state is not None:
            path = self.checkpoint_mgr.save('model_state', model_state.to_dict())
            saved['model_state'] = path
        
        if trainer is not None:
            path = self.checkpoint_mgr.save('trainer', trainer.to_dict())
            saved['trainer'] = path
        
        if extreme_ratio is not None:
            if hasattr(extreme_ratio, 'to_dict'):
                path = self.checkpoint_mgr.save('extreme_ratio', extreme_ratio.to_dict())
                saved['extreme_ratio'] = path
        
        if stability_engine is not None:
            if hasattr(stability_engine, 'to_dict'):
                path = self.checkpoint_mgr.save('stability_engine', stability_engine.to_dict())
                saved['stability_engine'] = path
        
        return saved
    
    def load_all(self) -> Dict[str, Optional[Dict[str, Any]]]:
        """
        Load all component states.
        
        Returns dict of component name -> state dict (or None if not found).
        """
        return {
            'model_state': self.checkpoint_mgr.load('model_state'),
            'trainer': self.checkpoint_mgr.load('trainer'),
            'extreme_ratio': self.checkpoint_mgr.load('extreme_ratio'),
            'stability_engine': self.checkpoint_mgr.load('stability_engine'),
        }
    
    def save_model_state(self, model_state: Any) -> str:
        """Save ModelState."""
        return self.checkpoint_mgr.save('model_state', model_state.to_dict())
    
    def load_model_state(self) -> Optional[Dict[str, Any]]:
        """Load ModelState data."""
        return self.checkpoint_mgr.load('model_state')
    
    def save_trainer(self, trainer: Any) -> str:
        """Save OnlineTrainer."""
        return self.checkpoint_mgr.save('trainer', trainer.to_dict())
    
    def load_trainer(self) -> Optional[Dict[str, Any]]:
        """Load OnlineTrainer data."""
        return self.checkpoint_mgr.load('trainer')
    
    def has_state(self) -> bool:
        """Check if any state exists."""
        return any([
            self.checkpoint_mgr.exists('model_state'),
            self.checkpoint_mgr.exists('trainer'),
            self.checkpoint_mgr.exists('extreme_ratio'),
            self.checkpoint_mgr.exists('stability_engine'),
        ])
    
    def get_state_info(self) -> Dict[str, Any]:
        """Get info about persisted state."""
        return {
            'state_dir': self.state_dir,
            'has_state': self.has_state(),
            'checkpoints': self.checkpoint_mgr.list_checkpoints(),
        }
    
    def clear_all(self):
        """Clear all persisted state."""
        for name in ['model_state', 'trainer', 'extreme_ratio', 'stability_engine']:
            self.checkpoint_mgr.delete(name)
    
    def export_state(self, output_path: str):
        """
        Export all state to a single archive file.
        Useful for transferring learned state to another system.
        """
        all_state = self.load_all()
        
        # Filter out None values
        state_to_export = {k: v for k, v in all_state.items() if v is not None}
        
        export_data = {
            'version': CheckpointManager.VERSION,
            'exported_at': time.time(),
            'components': state_to_export,
        }
        
        json_data = json.dumps(export_data, indent=2, default=str)
        compressed = gzip.compress(json_data.encode('utf-8'))
        
        Path(output_path).write_bytes(compressed)
    
    def import_state(self, input_path: str) -> bool:
        """
        Import state from exported archive.
        Returns True if successful.
        """
        try:
            data = Path(input_path).read_bytes()
            if data[:2] == b'\x1f\x8b':
                data = gzip.decompress(data)
            
            export_data = json.loads(data.decode('utf-8'))
            components = export_data.get('components', {})
            
            for name, state in components.items():
                self.checkpoint_mgr.save(name, state)
            
            return True
        
        except Exception:
            return False
