# SPK V9 & V10 API Reference

## V9: Autonomous Data Intelligence API

### Health Monitoring

#### Scan Archive Health
```http
POST /api/v9/health/scan
Content-Type: application/json

{
  "archive_id": "archive-uuid-here"
}
```

**Response:**
```json
{
  "report": {
    "status": "Healthy" | "Warning" | "Critical" | "Failed",
    "scan_time": 1234567890,
    "anomalies": [
      {
        "type": "Corruption" | "ChecksumMismatch" | "MissingChunk" | "PerformanceDegradation" | "ReplicationLag" | "DiskError",
        "severity": 1-10,
        "location": "chunk_id",
        "message": "Description"
      }
    ],
    "predictions": [
      {
        "failure_type": "HardwareFailure" | "DataCorruption" | "NetworkFailure" | "ResourceExhaustion" | "ReplicationFailure" | "PerformanceDegradation",
        "probability": 0.0-1.0,
        "time_estimate": 3600,
        "confidence": 0.0-1.0
      }
    ],
    "recommendations": ["Action 1", "Action 2"]
  },
  "actions_taken": ["Description of actions"]
}
```

---

#### Repair Corrupted Chunks
```http
POST /api/v9/health/repair
Content-Type: application/json

{
  "archive_id": "archive-uuid-here",
  "chunk_ids": [123, 456, 789],
  "auto_mode": true
}
```

**Response:**
```json
{
  "success": true,
  "chunks_repaired": 3,
  "chunks_failed": 0,
  "details": "Repaired 3 chunks successfully"
}
```

---

#### Get Failure Predictions
```http
POST /api/v9/health/predict
Content-Type: application/json

{
  "archive_id": "archive-uuid-here",
  "time_window": 86400
}
```

**Response:**
```json
{
  "predictions": [
    {
      "failure_type": "DataCorruption",
      "probability": 0.15,
      "time_estimate": 3600,
      "confidence": 0.85
    }
  ],
  "time_window": 86400,
  "confidence": 0.85
}
```

---

#### Get Archive Health Status
```http
GET /api/v9/health/status/:archive_id
```

**Response:**
```json
{
  "archive_id": "archive-uuid-here",
  "status": "Healthy",
  "last_scan": 1234567890,
  "anomalies": 0,
  "predictions": 1
}
```

---

#### Query Integrity Logs
```http
POST /api/v9/integrity/logs
Content-Type: application/json

{
  "archive_id": "archive-uuid-here",
  "event_type": "Repair" | "Read" | "Write" | "Delete" | "Verify" | "Error",
  "start_time": 1234567890,
  "end_time": 1234567999
}
```

**Response:**
```json
{
  "archive_id": "archive-uuid-here",
  "log_count": 42,
  "logs": [
    {
      "timestamp": 1234567890,
      "action": "Repair",
      "chunk_id": 123,
      "user": "system",
      "success": true,
      "details": "Chunk repaired from parity",
      "hash": "blake3_hash",
      "priority": "High"
    }
  ]
}
```

---

#### Configure Archive Maintenance
```http
POST /api/v9/maintenance/config
Content-Type: application/json

{
  "archive_id": "archive-uuid-here",
  "scan_interval": 3600,
  "enable_auto_repair": true,
  "redundancy_level": "single" | "double" | "triple" | "distributed"
}
```

**Response:**
```json
{
  "status": "configured",
  "archive_id": "archive-uuid-here",
  "scan_interval": 3600,
  "auto_repair": true,
  "redundancy": "double"
}
```

---

## V10: Universal Interoperability API

### Plugin Management

#### Register New Plugin
```http
POST /api/v10/plugins/register
Content-Type: application/json

{
  "plugin_id": "my-codec-plugin",
  "plugin_type": "codec" | "format_handler" | "metadata_extractor",
  "version": "1.0.0",
  "capabilities": ["compress", "decompress", "stream"]
}
```

**Response:**
```json
{
  "success": true,
  "plugin_id": "my-codec-plugin",
  "message": "Plugin 'my-codec-plugin' registered successfully"
}
```

---

#### List Available Plugins
```http
GET /api/v10/plugins/list
```

**Response:**
```json
{
  "codecs": [
    {
      "name": "zstd",
      "description": "Zstandard compression",
      "version": "1.5.0"
    }
  ],
  "formats": ["tar", "zip", "7z", "iso"],
  "extractors": []
}
```

---

#### Get Plugin Info
```http
GET /api/v10/plugins/:plugin_id
```

**Response:**
```json
{
  "plugin_id": "zstd-codec",
  "status": "active",
  "version": "1.5.0",
  "capabilities": ["compress", "decompress", "stream"]
}
```

---

### Format Detection

#### Detect Archive Format
```http
GET /api/v10/format/detect/:path
```

**Response:**
```json
{
  "path": "/path/to/archive.tar.gz",
  "format": "tar",
  "confidence": "high"
}
```

**Supported Formats:**
- `spk` - Singularity Pack
- `tar` - TAR archive
- `zip` - ZIP archive
- `7z` - 7-Zip archive
- `iso` - ISO 9660 image
- `gzip` - GZIP compressed
- `bzip2` - BZIP2 compressed
- `xz` - XZ compressed

---

### Container Mounting

#### Mount SPK Container
```http
POST /api/v10/container/mount
Content-Type: application/json

{
  "container_path": "/path/to/container.spk",
  "mount_point": "/mnt/spk/container1",
  "read_only": false
}
```

**Response:**
```json
{
  "status": "mounted",
  "container": "/path/to/container.spk",
  "mount_point": "/mnt/spk/container1",
  "read_only": false
}
```

---

#### Unmount Container
```http
POST /api/v10/container/unmount/:mount_point
```

**Response:**
```json
{
  "status": "unmounted",
  "mount_point": "/mnt/spk/container1"
}
```

---

#### List Mounted Containers
```http
GET /api/v10/container/list
```

**Response:**
```json
{
  "containers": [
    {
      "id": "uuid-here",
      "mount_path": "/mnt/spk/container1",
      "format": "spk",
      "writable": true
    }
  ],
  "count": 1
}
```

---

### Format Interoperability

#### Import from External Format
```http
POST /api/v10/interop/import
Content-Type: application/json

{
  "source_path": "/path/to/archive.tar.gz",
  "source_format": "tar" | "zip" | "7z" | "iso",
  "target_path": "/path/to/output.spk",
  "compression_level": 9
}
```

**Response:**
```json
{
  "status": "imported",
  "source": "/path/to/archive.tar.gz",
  "target": "/path/to/output.spk",
  "format": "tar"
}
```

---

#### Export to External Format
```http
POST /api/v10/interop/export
Content-Type: application/json

{
  "source_path": "/path/to/archive.spk",
  "target_path": "/path/to/output.tar.gz",
  "target_format": "tar" | "zip" | "7z" | "iso"
}
```

**Response:**
```json
{
  "status": "exported",
  "source": "/path/to/archive.spk",
  "target": "/path/to/output.tar.gz",
  "format": "tar"
}
```

---

### Extension Blocks

#### Add Extension Block
```http
POST /api/v10/extensions/add
Content-Type: application/json

{
  "archive_id": "archive-uuid-here",
  "extension_type": "custom-metadata",
  "data": {
    "key1": "value1",
    "key2": 42
  }
}
```

**Response:**
```json
{
  "status": "added",
  "archive_id": "archive-uuid-here",
  "extension_type": "custom-metadata"
}
```

---

#### Get Archive Extensions
```http
GET /api/v10/extensions/:archive_id
```

**Response:**
```json
{
  "archive_id": "archive-uuid-here",
  "extensions": ["custom-metadata", "geo-location"],
  "count": 2
}
```

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": "Additional details about the error"
}
```

**HTTP Status Codes:**
- `200 OK` - Success
- `400 Bad Request` - Invalid input
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error

---

## Authentication

Currently, the API does not require authentication. In production:

```http
Authorization: Bearer <token>
```

---

## Rate Limiting

Default limits:
- **V9 Health Scans**: 10/minute per archive
- **V9 Repairs**: 5/minute per archive
- **V10 Imports/Exports**: 2/minute per user
- **V10 Plugin Registration**: 100/hour

---

## WebSocket Support (Future)

Real-time health monitoring:

```javascript
const ws = new WebSocket('ws://localhost:3000/api/v9/health/stream');

ws.onmessage = (event) => {
  const health = JSON.parse(event.data);
  console.log('Health update:', health);
};
```

---

## SDK Examples

### Rust
```rust
use spk_core::autonomous::HealthMonitor;
use spk_core::interop::PluginRegistry;

// V9: Health monitoring
let mut monitor = HealthMonitor::new("archive-id");
let report = monitor.scan(100)?;
println!("Status: {:?}", report.status);

// V10: Plugin registration
let registry = PluginRegistry::new();
registry.register_codec(...)?;
```

### Python (Future)
```python
from spk import HealthMonitor, PluginRegistry

# V9: Health monitoring
monitor = HealthMonitor("archive-id")
report = monitor.scan(max_chunks=100)
print(f"Status: {report.status}")

# V10: Format detection
from spk import FormatDetector
format = FormatDetector.detect_format(data)
```

---

## See Also
- [SPK Format Specification](../format-spec/SPK_Format_v1.md)
- [V9/V10 Implementation Details](V9_V10_IMPLEMENTATION.md)
- [API Changelog](CHANGELOG.md)
