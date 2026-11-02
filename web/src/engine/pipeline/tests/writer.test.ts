/**
 * SPK Archive Writer Tests
 * 
 * Tests for the archive writer:
 * - Chunk writing and ordering
 * - Offset calculation
 * - Archive assembly
 * - Multi-file support
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ArchiveWriter,
  MetadataTableBuilder,
  ArchiveReader,
  type FileEntry,
} from '../writer';

// ============================================================================
// CONSTANTS
// ============================================================================

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

// ============================================================================
// HELPERS
// ============================================================================

function generateRandomBytes(size: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = Math.floor(Math.random() * 256);
  }
  return data;
}

function generateFakeHash(): string {
  const chars = '0123456789abcdef';
  let hash = '';
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * 16)];
  }
  return hash;
}

// ============================================================================
// WRITER TESTS
// ============================================================================

describe('ArchiveWriter', () => {
  describe('Initialization', () => {
    it('should create writer with expected chunks', () => {
      const writer = new ArchiveWriter(10);
      expect(writer).toBeDefined();
    });

    it('should reject invalid chunk count', () => {
      expect(() => new ArchiveWriter(0)).toThrow();
      expect(() => new ArchiveWriter(-1)).toThrow();
    });
  });

  // ==========================================================================
  // CHUNK WRITING TESTS
  // ==========================================================================

  describe('Chunk Writing', () => {
    it('should accept chunks in order', () => {
      const writer = new ArchiveWriter(5);
      
      for (let i = 0; i < 5; i++) {
        writer.writeChunk(i, generateRandomBytes(100), 200, generateFakeHash());
      }
      
      expect(writer.isReady()).toBe(true);
    });

    it('should accept chunks out of order', () => {
      const writer = new ArchiveWriter(5);
      
      // Write chunks in random order
      [3, 1, 4, 0, 2].forEach(i => {
        writer.writeChunk(i, generateRandomBytes(100), 200, generateFakeHash());
      });
      
      expect(writer.isReady()).toBe(true);
    });

    it('should reject duplicate chunks', () => {
      const writer = new ArchiveWriter(5);
      
      writer.writeChunk(0, generateRandomBytes(100), 200, generateFakeHash());
      
      // Writing same chunk again should not increase count
      writer.writeChunk(0, generateRandomBytes(100), 200, generateFakeHash());
      
      const missing = writer.getMissingChunks();
      expect(missing.length).toBe(4); // Still missing 4 chunks
    });

    it('should reject invalid chunk indices', () => {
      const writer = new ArchiveWriter(5);
      
      expect(() => {
        writer.writeChunk(-1, generateRandomBytes(100), 200, generateFakeHash());
      }).toThrow();
      
      expect(() => {
        writer.writeChunk(5, generateRandomBytes(100), 200, generateFakeHash());
      }).toThrow();
    });

    it('should track missing chunks correctly', () => {
      const writer = new ArchiveWriter(5);
      
      writer.writeChunk(0, generateRandomBytes(100), 200, generateFakeHash());
      writer.writeChunk(2, generateRandomBytes(100), 200, generateFakeHash());
      writer.writeChunk(4, generateRandomBytes(100), 200, generateFakeHash());
      
      const missing = writer.getMissingChunks();
      expect(missing).toEqual([1, 3]);
    });
  });

  // ==========================================================================
  // OFFSET CALCULATION TESTS
  // ==========================================================================

  describe('Offset Calculation', () => {
    it('should calculate sequential offsets correctly', () => {
      const writer = new ArchiveWriter(3);
      const chunkSizes = [100, 200, 150];
      
      for (let i = 0; i < 3; i++) {
        writer.writeChunk(i, generateRandomBytes(chunkSizes[i]), 500, generateFakeHash());
      }
      
      const metadata = writer.buildMetadata();
      
      // Header is 64 bytes
      expect(metadata.chunkTable[0].offset).toBe(64);
      expect(metadata.chunkTable[1].offset).toBe(64 + 100);
      expect(metadata.chunkTable[2].offset).toBe(64 + 100 + 200);
    });

    it('should handle out-of-order chunks with correct offsets', () => {
      const writer = new ArchiveWriter(3);
      const chunkSizes = [100, 200, 150];
      
      // Write out of order
      writer.writeChunk(2, generateRandomBytes(chunkSizes[2]), 500, generateFakeHash());
      writer.writeChunk(0, generateRandomBytes(chunkSizes[0]), 500, generateFakeHash());
      writer.writeChunk(1, generateRandomBytes(chunkSizes[1]), 500, generateFakeHash());
      
      const metadata = writer.buildMetadata();
      
      // Offsets should still be in order
      expect(metadata.chunkTable[0].offset).toBe(64);
      expect(metadata.chunkTable[1].offset).toBe(64 + 100);
      expect(metadata.chunkTable[2].offset).toBe(64 + 100 + 200);
    });
  });

  // ==========================================================================
  // ARCHIVE ASSEMBLY TESTS
  // ==========================================================================

  describe('Archive Assembly', () => {
    it('should assemble valid archive blob', async () => {
      const writer = new ArchiveWriter(3);
      
      for (let i = 0; i < 3; i++) {
        writer.writeChunk(i, generateRandomBytes(100), 200, generateFakeHash());
      }
      
      const blob = writer.assembleArchive();
      
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);
    });

    it('should fail assembly if chunks missing', () => {
      const writer = new ArchiveWriter(5);
      
      writer.writeChunk(0, generateRandomBytes(100), 200, generateFakeHash());
      writer.writeChunk(1, generateRandomBytes(100), 200, generateFakeHash());
      // Missing chunks 2, 3, 4
      
      expect(() => writer.assembleArchive()).toThrow();
    });

    it('should include metadata in archive', async () => {
      const writer = new ArchiveWriter(2);
      
      writer.writeChunk(0, generateRandomBytes(100), 200, generateFakeHash());
      writer.writeChunk(1, generateRandomBytes(150), 300, generateFakeHash());
      
      writer.addFileEntry({
        id: 'test-file',
        name: 'test.bin',
        size: 500,
        mimeType: 'application/octet-stream',
        startChunk: 0,
        endChunk: 1,
        startOffset: 0,
        lastModified: Date.now(),
      });
      
      const blob = writer.assembleArchive();
      const reader = new ArchiveReader(blob);
      const metadata = await reader.parseMetadata();
      
      expect(metadata.totalChunks).toBe(2);
      expect(metadata.fileEntries.length).toBe(1);
      expect(metadata.fileEntries[0].name).toBe('test.bin');
    });
  });

  // ==========================================================================
  // HEAVY FILE SIZE TESTS
  // ==========================================================================

  describe('Heavy File Size Tests', () => {
    it('should handle 100MB simulated file (100 chunks × 1MB)', () => {
      const numChunks = 100;
      const chunkOriginalSize = 1 * MB;
      const writer = new ArchiveWriter(numChunks);
      
      for (let i = 0; i < numChunks; i++) {
        // Use small compressed size for test efficiency
        writer.writeChunk(i, generateRandomBytes(256), chunkOriginalSize, generateFakeHash());
      }
      
      expect(writer.isReady()).toBe(true);
      
      const metadata = writer.buildMetadata();
      expect(metadata.totalChunks).toBe(numChunks);
      expect(metadata.totalOriginalSize).toBe(numChunks * chunkOriginalSize);
    });

    it('should handle 1GB simulated file (256 chunks × 4MB)', () => {
      const numChunks = 256;
      const chunkOriginalSize = 4 * MB;
      const writer = new ArchiveWriter(numChunks);
      
      for (let i = 0; i < numChunks; i++) {
        writer.writeChunk(i, generateRandomBytes(128), chunkOriginalSize, generateFakeHash());
      }
      
      expect(writer.isReady()).toBe(true);
      
      const metadata = writer.buildMetadata();
      expect(metadata.totalChunks).toBe(numChunks);
    });

    it('should handle 10GB simulated file (640 chunks × 16MB)', () => {
      const numChunks = 640;
      const chunkOriginalSize = 16 * MB;
      const writer = new ArchiveWriter(numChunks);
      
      for (let i = 0; i < numChunks; i++) {
        writer.writeChunk(i, generateRandomBytes(64), chunkOriginalSize, generateFakeHash());
      }
      
      expect(writer.isReady()).toBe(true);
    });

    it('should handle 1TB simulated file (16384 chunks × 64MB)', () => {
      const numChunks = 16384;
      const chunkOriginalSize = 64 * MB;
      const writer = new ArchiveWriter(numChunks);
      
      for (let i = 0; i < numChunks; i++) {
        writer.writeChunk(i, generateRandomBytes(32), chunkOriginalSize, generateFakeHash());
      }
      
      expect(writer.isReady()).toBe(true);
    });
  });

  // ==========================================================================
  // MULTI-FILE TESTS
  // ==========================================================================

  describe('Multi-File Support', () => {
    it('should handle 10 files × 50MB each', () => {
      const filesCount = 10;
      const chunksPerFile = 50;
      const totalChunks = filesCount * chunksPerFile;
      const writer = new ArchiveWriter(totalChunks);
      
      for (let f = 0; f < filesCount; f++) {
        writer.addFileEntry({
          id: `file-${f}`,
          name: `file-${f}.bin`,
          size: 50 * MB,
          mimeType: 'application/octet-stream',
          startChunk: f * chunksPerFile,
          endChunk: (f + 1) * chunksPerFile - 1,
          startOffset: 0,
          lastModified: Date.now(),
        });
      }
      
      for (let i = 0; i < totalChunks; i++) {
        writer.writeChunk(i, generateRandomBytes(64), 1 * MB, generateFakeHash());
      }
      
      expect(writer.isReady()).toBe(true);
      
      const metadata = writer.buildMetadata();
      expect(metadata.fileEntries.length).toBe(10);
    });

    it('should handle 1000+ files batch', () => {
      const numFiles = 1000;
      const writer = new ArchiveWriter(numFiles);
      
      for (let i = 0; i < numFiles; i++) {
        writer.addFileEntry({
          id: `file-${i}`,
          name: `document-${i}.pdf`,
          size: 512 * KB,
          mimeType: 'application/pdf',
          startChunk: i,
          endChunk: i,
          startOffset: 0,
          lastModified: Date.now(),
        });
        
        writer.writeChunk(i, generateRandomBytes(64), 512 * KB, generateFakeHash());
      }
      
      expect(writer.isReady()).toBe(true);
    });

    it('should handle 5000 files batch', () => {
      const numFiles = 5000;
      const writer = new ArchiveWriter(numFiles);
      
      for (let i = 0; i < numFiles; i++) {
        writer.addFileEntry({
          id: `file-${i}`,
          name: `image-${i}.jpg`,
          size: 256 * KB,
          mimeType: 'image/jpeg',
          startChunk: i,
          endChunk: i,
          startOffset: 0,
          lastModified: Date.now(),
        });
        
        writer.writeChunk(i, generateRandomBytes(32), 256 * KB, generateFakeHash());
      }
      
      expect(writer.isReady()).toBe(true);
      
      const metadata = writer.buildMetadata();
      expect(metadata.fileEntries.length).toBe(5000);
    });
  });

  // ==========================================================================
  // FILE TYPE TESTS
  // ==========================================================================

  describe('File Type Support', () => {
    const fileTypes = [
      { ext: 'pdf', mime: 'application/pdf' },
      { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { ext: 'jpg', mime: 'image/jpeg' },
      { ext: 'png', mime: 'image/png' },
      { ext: 'mp4', mime: 'video/mp4' },
      { ext: 'mp3', mime: 'audio/mpeg' },
      { ext: 'zip', mime: 'application/zip' },
      { ext: 'exe', mime: 'application/x-msdownload' },
      { ext: 'bin', mime: 'application/octet-stream' },
    ];

    it('should handle all common file types', async () => {
      const writer = new ArchiveWriter(fileTypes.length);
      
      fileTypes.forEach((type, index) => {
        writer.addFileEntry({
          id: `file-${index}`,
          name: `test.${type.ext}`,
          size: 1 * MB,
          mimeType: type.mime,
          startChunk: index,
          endChunk: index,
          startOffset: 0,
          lastModified: Date.now(),
        });
        
        writer.writeChunk(index, generateRandomBytes(512), 1 * MB, generateFakeHash());
      });
      
      expect(writer.isReady()).toBe(true);
      
      const blob = writer.assembleArchive();
      const reader = new ArchiveReader(blob);
      const metadata = await reader.parseMetadata();
      
      expect(metadata.fileEntries.length).toBe(fileTypes.length);
      
      fileTypes.forEach((type, index) => {
        expect(metadata.fileEntries[index].mimeType).toBe(type.mime);
      });
    });
  });

  // ==========================================================================
  // RECOVERY TESTS
  // ==========================================================================

  describe('Recovery', () => {
    it('should track and report missing chunks', () => {
      const writer = new ArchiveWriter(10);
      
      [0, 2, 4, 6, 8].forEach(i => {
        writer.writeChunk(i, generateRandomBytes(100), 200, generateFakeHash());
      });
      
      const missing = writer.getMissingChunks();
      expect(missing).toEqual([1, 3, 5, 7, 9]);
    });
  });

  // ==========================================================================
  // ARCHIVE READER TESTS
  // ==========================================================================

  describe('ArchiveReader', () => {
    it('should parse header correctly', async () => {
      const writer = new ArchiveWriter(2);
      
      writer.writeChunk(0, generateRandomBytes(100), 200, generateFakeHash());
      writer.writeChunk(1, generateRandomBytes(100), 200, generateFakeHash());
      
      const blob = writer.assembleArchive();
      const reader = new ArchiveReader(blob);
      
      const header = await reader.parseHeader();
      
      expect(header.magic).toBe(0x53504B00);
      expect(header.chunkCount).toBe(2);
    });

    it('should parse footer correctly', async () => {
      const writer = new ArchiveWriter(3);
      
      for (let i = 0; i < 3; i++) {
        writer.writeChunk(i, generateRandomBytes(100), 200, generateFakeHash());
      }
      
      const blob = writer.assembleArchive();
      const reader = new ArchiveReader(blob);
      
      const footer = await reader.parseFooter();
      
      expect(footer.magic).toBe(0x53504B45);
      expect(footer.chunkCount).toBe(3);
    });
  });

  // ==========================================================================
  // METADATA TABLE BUILDER TESTS
  // ==========================================================================

  describe('MetadataTableBuilder', () => {
    it('should create file entries correctly', () => {
      const builder = new MetadataTableBuilder();
      
      builder.addFile('test.pdf', 5 * MB, 'application/pdf', Date.now(), 1 * MB);
      
      const entries = builder.getEntries();
      
      expect(entries.length).toBe(1);
      expect(entries[0].name).toBe('test.pdf');
      expect(entries[0].size).toBe(5 * MB);
    });

    it('should track chunks across multiple files', () => {
      const builder = new MetadataTableBuilder();
      const chunkSize = 1 * MB;
      
      builder.addFile('file1.bin', 3 * MB, 'application/octet-stream', Date.now(), chunkSize);
      builder.addFile('file2.bin', 2 * MB, 'application/octet-stream', Date.now(), chunkSize);
      
      const entries = builder.getEntries();
      const totalChunks = builder.getTotalChunks();
      
      expect(entries.length).toBe(2);
      expect(totalChunks).toBe(5); // 3 + 2
      
      // File 1: chunks 0-2
      expect(entries[0].startChunk).toBe(0);
      expect(entries[0].endChunk).toBe(2);
      
      // File 2: chunks 3-4
      expect(entries[1].startChunk).toBe(3);
      expect(entries[1].endChunk).toBe(4);
    });
  });

  // ==========================================================================
  // STRESS TESTS
  // ==========================================================================

  describe('Stress Tests', () => {
    it('should handle rapid chunk writes', () => {
      const numChunks = 10000;
      const writer = new ArchiveWriter(numChunks);
      
      const startTime = Date.now();
      
      for (let i = 0; i < numChunks; i++) {
        writer.writeChunk(i, generateRandomBytes(32), 1024, generateFakeHash());
      }
      
      const duration = Date.now() - startTime;
      
      expect(writer.isReady()).toBe(true);
      console.log(`${numChunks} chunks written in ${duration}ms`);
    });

    it('should handle random order chunk writes', () => {
      const numChunks = 1000;
      const writer = new ArchiveWriter(numChunks);
      
      // Create shuffled indices
      const indices = Array.from({ length: numChunks }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      
      for (const idx of indices) {
        writer.writeChunk(idx, generateRandomBytes(64), 2048, generateFakeHash());
      }
      
      expect(writer.isReady()).toBe(true);
      
      // Verify metadata is built correctly
      const metadata = writer.buildMetadata();
      
      // Offsets should be sequential
      let prevOffset = 64;
      for (const chunk of metadata.chunkTable) {
        expect(chunk.offset).toBe(prevOffset);
        prevOffset += chunk.length;
      }
    });
  });

  // ==========================================================================
  // EVENT HANDLER TESTS
  // ==========================================================================

  describe('Event Handlers', () => {
    it('should handle concurrent event handlers', () => {
      const writer = new ArchiveWriter(3);
      const events: string[] = [];
      
      writer.onEvent((event) => {
        events.push(event.type);
      });
      
      for (let i = 0; i < 3; i++) {
        writer.writeChunk(i, generateRandomBytes(100), 200, generateFakeHash());
      }
      
      expect(events).toContain('chunk-stored');
      expect(events).toContain('all-chunks-ready');
    });
  });
});
