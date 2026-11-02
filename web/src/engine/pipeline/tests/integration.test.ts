/**
 * SPK Integration Tests
 * 
 * End-to-end tests for the complete pipeline:
 * - Full compression workflow
 * - Writer + Coordinator integration
 * - Any file type handling
 * - Any file size handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ArchiveWriter,
  ArchiveReader,
  MetadataTableBuilder,
} from '../writer';
import {
  Coordinator,
  resetCoordinator,
} from '../coordinator';
import {
  DynamicChunkSizer,
  resetDynamicChunkSizer,
  calculateFileSizeBasedChunk,
} from '../chunk-sizer';

// ============================================================================
// TEST UTILITIES
// ============================================================================

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

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

async function computeHash(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Pipeline Integration', () => {
  beforeEach(() => {
    resetCoordinator();
    resetDynamicChunkSizer();
  });

  // ==========================================================================
  // WRITER + READER ROUND-TRIP
  // ==========================================================================

  describe('Writer/Reader Round-Trip', () => {
    it('should create and verify archive', async () => {
      const numChunks = 5;
      const chunkSize = 1024;
      const writer = new ArchiveWriter(numChunks);
      
      // Write chunks
      for (let i = 0; i < numChunks; i++) {
        const data = generateRandomBytes(chunkSize);
        const hash = await computeHash(data);
        writer.writeChunk(i, data, chunkSize * 2, hash);
      }
      
      // Add file entry
      writer.addFileEntry({
        id: 'test-file',
        name: 'test.bin',
        size: numChunks * chunkSize * 2,
        mimeType: 'application/octet-stream',
        startChunk: 0,
        endChunk: numChunks - 1,
        startOffset: 0,
        lastModified: Date.now(),
      });
      
      // Assemble
      const blob = writer.assembleArchive();
      
      // Read back
      const reader = new ArchiveReader(blob);
      const header = await reader.parseHeader();
      const footer = await reader.parseFooter();
      const metadata = await reader.parseMetadata();
      
      // Verify
      expect(header.chunkCount).toBe(numChunks);
      expect(footer.chunkCount).toBe(numChunks);
      expect(metadata.totalChunks).toBe(numChunks);
      expect(metadata.fileEntries.length).toBe(1);
      expect(metadata.fileEntries[0].name).toBe('test.bin');
    });

    it('should preserve chunk data integrity', async () => {
      const numChunks = 3;
      const originalData: Uint8Array[] = [];
      const hashes: string[] = [];
      const writer = new ArchiveWriter(numChunks);
      
      // Write chunks and save original data
      for (let i = 0; i < numChunks; i++) {
        const data = generateRandomBytes(512);
        originalData.push(data);
        const hash = await computeHash(data);
        hashes.push(hash);
        writer.writeChunk(i, data, 1024, hash);
      }
      
      const blob = writer.assembleArchive();
      const reader = new ArchiveReader(blob);
      const metadata = await reader.parseMetadata();
      
      // Verify hashes match
      for (let i = 0; i < numChunks; i++) {
        expect(metadata.chunkTable[i].sha256).toBe(hashes[i]);
      }
    });
  });

  // ==========================================================================
  // MULTI-FILE ARCHIVE TESTS
  // ==========================================================================

  describe('Multi-File Archives', () => {
    it('should handle multiple files in one archive', async () => {
      const builder = new MetadataTableBuilder();
      const chunkSize = 1 * MB;
      
      // Add files
      const files = [
        { name: 'doc.pdf', size: 5 * MB },
        { name: 'image.jpg', size: 2 * MB },
        { name: 'data.bin', size: 10 * MB },
      ];
      
      files.forEach(f => {
        builder.addFile(f.name, f.size, 'application/octet-stream', Date.now(), chunkSize);
      });
      
      const entries = builder.getEntries();
      const totalChunks = builder.getTotalChunks();
      
      expect(entries.length).toBe(3);
      expect(totalChunks).toBe(5 + 2 + 10); // 17 chunks total
      
      // Create archive
      const writer = new ArchiveWriter(totalChunks);
      entries.forEach(e => writer.addFileEntry(e));
      
      for (let i = 0; i < totalChunks; i++) {
        writer.writeChunk(i, generateRandomBytes(512), chunkSize, generateFakeHash());
      }
      
      expect(writer.isReady()).toBe(true);
      
      const blob = writer.assembleArchive();
      const reader = new ArchiveReader(blob);
      const metadata = await reader.parseMetadata();
      
      expect(metadata.fileEntries.length).toBe(3);
      expect(metadata.totalChunks).toBe(17);
    });

    it('should preserve file boundaries', () => {
      const builder = new MetadataTableBuilder();
      const chunkSize = 1 * MB;
      
      builder.addFile('file1.bin', 2 * MB, 'application/octet-stream', Date.now(), chunkSize);
      builder.addFile('file2.bin', 3 * MB, 'application/octet-stream', Date.now(), chunkSize);
      builder.addFile('file3.bin', 1 * MB, 'application/octet-stream', Date.now(), chunkSize);
      
      const entries = builder.getEntries();
      
      // File 1: chunks 0-1
      expect(entries[0].startChunk).toBe(0);
      expect(entries[0].endChunk).toBe(1);
      
      // File 2: chunks 2-4
      expect(entries[1].startChunk).toBe(2);
      expect(entries[1].endChunk).toBe(4);
      
      // File 3: chunk 5
      expect(entries[2].startChunk).toBe(5);
      expect(entries[2].endChunk).toBe(5);
    });
  });

  // ==========================================================================
  // CHUNK SIZER INTEGRATION
  // ==========================================================================

  describe('Chunk Sizer Integration', () => {
    it('should recommend appropriate sizes for different file sizes', () => {
      const testCases = [
        { fileSize: 10 * MB, expectedChunks: 3 },   // 10MB / 4MB = 2.5 ≈ 3
        { fileSize: 100 * MB, expectedChunks: 7 },  // 100MB / 16MB = 6.25 ≈ 7
        { fileSize: 1 * GB, expectedChunks: 16 },   // 1GB / 64MB = 16
        { fileSize: 10 * GB, expectedChunks: 80 },  // 10GB / 128MB = 80
      ];
      
      testCases.forEach(({ fileSize, expectedChunks }) => {
        const chunkSize = calculateFileSizeBasedChunk(fileSize);
        const numChunks = Math.ceil(fileSize / chunkSize);
        
        expect(numChunks).toBe(expectedChunks);
      });
    });

    it('should adapt chunk size based on performance', () => {
      const sizer = new DynamicChunkSizer();
      
      // Simulate good performance
      for (let i = 0; i < 10; i++) {
        sizer.recordSample(4 * MB, 100, true);
      }
      
      const rec = sizer.getRecommendation();
      
      expect(rec.size).toBeGreaterThanOrEqual(4 * MB);
      expect(rec.mode).toBe('normal');
    });
  });

  // ==========================================================================
  // FILE TYPE TESTS
  // ==========================================================================

  describe('File Type Handling', () => {
    const allFileTypes = [
      // Documents
      { ext: 'pdf', mime: 'application/pdf' },
      { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { ext: 'txt', mime: 'text/plain' },
      
      // Images
      { ext: 'jpg', mime: 'image/jpeg' },
      { ext: 'png', mime: 'image/png' },
      { ext: 'gif', mime: 'image/gif' },
      
      // Video
      { ext: 'mp4', mime: 'video/mp4' },
      { ext: 'mkv', mime: 'video/x-matroska' },
      
      // Audio
      { ext: 'mp3', mime: 'audio/mpeg' },
      { ext: 'wav', mime: 'audio/wav' },
      
      // Archives
      { ext: 'zip', mime: 'application/zip' },
      { ext: '7z', mime: 'application/x-7z-compressed' },
      
      // Executables
      { ext: 'exe', mime: 'application/x-msdownload' },
      
      // Data
      { ext: 'json', mime: 'application/json' },
      { ext: 'csv', mime: 'text/csv' },
      
      // Binary
      { ext: 'bin', mime: 'application/octet-stream' },
    ];

    it('should support all common file types', async () => {
      const writer = new ArchiveWriter(allFileTypes.length);
      
      allFileTypes.forEach((type, index) => {
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
      
      expect(metadata.fileEntries.length).toBe(allFileTypes.length);
      
      // Verify all MIME types preserved
      allFileTypes.forEach((type, index) => {
        expect(metadata.fileEntries[index].mimeType).toBe(type.mime);
        expect(metadata.fileEntries[index].name).toBe(`test.${type.ext}`);
      });
    });

    it('should treat all files as binary streams', () => {
      const binaryTypes = ['exe', 'dll', 'pdf', 'jpg', 'mp4', 'zip'];
      
      binaryTypes.forEach(ext => {
        const writer = new ArchiveWriter(1);
        const data = generateRandomBytes(1024);
        
        writer.addFileEntry({
          id: `test-${ext}`,
          name: `file.${ext}`,
          size: 1024,
          mimeType: 'application/octet-stream',
          startChunk: 0,
          endChunk: 0,
          startOffset: 0,
          lastModified: Date.now(),
        });
        
        // Should accept without inspecting content
        expect(() => {
          writer.writeChunk(0, data, 1024, generateFakeHash());
        }).not.toThrow();
        
        expect(writer.isReady()).toBe(true);
      });
    });
  });

  // ==========================================================================
  // FILE SIZE TESTS
  // ==========================================================================

  describe('File Size Handling', () => {
    const sizeTests = [
      { size: 1 * MB, name: '1MB' },
      { size: 10 * MB, name: '10MB' },
      { size: 100 * MB, name: '100MB' },
      { size: 500 * MB, name: '500MB' },
      { size: 1 * GB, name: '1GB' },
      { size: 5 * GB, name: '5GB' },
      { size: 10 * GB, name: '10GB' },
      { size: 50 * GB, name: '50GB' },
      { size: 100 * GB, name: '100GB' },
      { size: 500 * GB, name: '500GB' },
      { size: 1 * TB, name: '1TB' },
      { size: 5 * TB, name: '5TB' },
      { size: 10 * TB, name: '10TB' },
    ];

    sizeTests.forEach(({ size, name }) => {
      it(`should handle ${name} file`, () => {
        const chunkSize = calculateFileSizeBasedChunk(size);
        const numChunks = Math.ceil(size / chunkSize);
        
        // Verify reasonable chunk count
        expect(numChunks).toBeGreaterThan(0);
        expect(numChunks).toBeLessThan(1000000); // Max ~1M chunks
        
        // Create simulated archive
        const writer = new ArchiveWriter(numChunks);
        
        // Just add first and last chunk to verify range works
        writer.writeChunk(0, generateRandomBytes(256), chunkSize, generateFakeHash());
        if (numChunks > 1) {
          writer.writeChunk(numChunks - 1, generateRandomBytes(256), chunkSize, generateFakeHash());
        }
        
        // Verify tracking
        const missing = writer.getMissingChunks();
        if (numChunks > 2) {
          expect(missing.length).toBe(numChunks - 2);
        }
      });
    });

    it('should calculate correct total size', () => {
      const numChunks = 100;
      const chunkOriginalSize = 10 * MB;
      const writer = new ArchiveWriter(numChunks);
      
      for (let i = 0; i < numChunks; i++) {
        writer.writeChunk(i, generateRandomBytes(256), chunkOriginalSize, generateFakeHash());
      }
      
      const metadata = writer.buildMetadata();
      expect(metadata.totalOriginalSize).toBe(numChunks * chunkOriginalSize);
    });
  });

  // ==========================================================================
  // RECOVERY TESTS
  // ==========================================================================

  describe('Recovery Scenarios', () => {
    it('should identify missing chunks for retry', () => {
      const writer = new ArchiveWriter(10);
      
      // Write some chunks
      [0, 2, 4, 6, 8].forEach(i => {
        writer.writeChunk(i, generateRandomBytes(256), 1024, generateFakeHash());
      });
      
      const missing = writer.getMissingChunks();
      expect(missing).toEqual([1, 3, 5, 7, 9]);
      
      // Complete the archive
      [1, 3, 5, 7, 9].forEach(i => {
        writer.writeChunk(i, generateRandomBytes(256), 1024, generateFakeHash());
      });
      
      expect(writer.isReady()).toBe(true);
      expect(writer.getMissingChunks()).toEqual([]);
    });
  });

  // ==========================================================================
  // STRESS TESTS
  // ==========================================================================

  describe('Stress Tests', () => {
    it('should handle 10000 chunks', () => {
      const numChunks = 10000;
      const writer = new ArchiveWriter(numChunks);
      const startTime = Date.now();
      
      for (let i = 0; i < numChunks; i++) {
        writer.writeChunk(i, generateRandomBytes(64), 1024, generateFakeHash());
      }
      
      const duration = Date.now() - startTime;
      
      expect(writer.isReady()).toBe(true);
      expect(duration).toBeLessThan(30000); // Under 30 seconds
      
      console.log(`10000 chunks processed in ${duration}ms`);
    });

    it('should handle 5000 files', () => {
      const numFiles = 5000;
      const writer = new ArchiveWriter(numFiles);
      
      for (let i = 0; i < numFiles; i++) {
        writer.addFileEntry({
          id: `file-${i}`,
          name: `document-${i.toString().padStart(5, '0')}.pdf`,
          size: 512 * KB,
          mimeType: 'application/pdf',
          startChunk: i,
          endChunk: i,
          startOffset: 0,
          lastModified: Date.now(),
        });
        
        writer.writeChunk(i, generateRandomBytes(128), 512 * KB, generateFakeHash());
      }
      
      expect(writer.isReady()).toBe(true);
      
      const metadata = writer.buildMetadata();
      expect(metadata.fileEntries.length).toBe(5000);
    });

    it('should handle random order writes efficiently', () => {
      const numChunks = 1000;
      const writer = new ArchiveWriter(numChunks);
      
      // Create shuffled indices
      const indices = Array.from({ length: numChunks }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      
      const startTime = Date.now();
      
      for (const idx of indices) {
        writer.writeChunk(idx, generateRandomBytes(256), 2048, generateFakeHash());
      }
      
      const duration = Date.now() - startTime;
      
      expect(writer.isReady()).toBe(true);
      expect(duration).toBeLessThan(10000);
      
      // Verify offsets are still sequential
      const metadata = writer.buildMetadata();
      let prevOffset = 64;
      for (const chunk of metadata.chunkTable) {
        expect(chunk.offset).toBe(prevOffset);
        prevOffset += chunk.length;
      }
    });
  });
});
