"""
HAMMA Redundancy Predictor Model

Clustering-based model for identifying duplicate patterns
across chunks using only signature metadata.

Creator: Onazi Treasure (OJ)
"""

import hashlib
from typing import Optional, Dict, List, Set
from collections import defaultdict


class RedundancyPredictor:
    """
    Identifies redundancy clusters based on chunk signatures.
    
    Uses locality-sensitive hashing (LSH) concepts for O(1) lookup.
    No content inspection - only signature matching.
    """
    
    def __init__(self, max_clusters: int = 100000):
        self._max_clusters = max_clusters
        
        # Signature -> cluster ID mapping
        self._signature_to_cluster: Dict[str, int] = {}
        
        # Cluster -> chunk indices mapping
        self._cluster_chunks: Dict[int, Set[int]] = defaultdict(set)
        
        # Prefix index for partial matching
        self._prefix_index: Dict[str, Set[int]] = defaultdict(set)
        
        # Next cluster ID
        self._next_cluster_id = 0
        
        # Stats
        self._predictions = 0
        self._duplicates_found = 0
        self._clusters_created = 0
    
    def predict(
        self,
        signature: str,
        chunk_index: int,
    ) -> Optional[int]:
        """
        Predict redundancy cluster for a chunk.
        
        Args:
            signature: Hash signature of chunk
            chunk_index: Index of chunk in sequence
            
        Returns:
            Cluster ID if redundant, None if unique
        """
        self._predictions += 1
        
        # Exact match check
        if signature in self._signature_to_cluster:
            cluster_id = self._signature_to_cluster[signature]
            self._cluster_chunks[cluster_id].add(chunk_index)
            self._duplicates_found += 1
            return cluster_id
        
        # Partial match using prefix (first 8 chars)
        prefix = signature[:8] if len(signature) >= 8 else signature
        
        # Check for similar signatures (prefix match)
        if prefix in self._prefix_index:
            # Found potential cluster
            existing_clusters = self._prefix_index[prefix]
            
            # Use first matching cluster
            for cluster_id in existing_clusters:
                self._signature_to_cluster[signature] = cluster_id
                self._cluster_chunks[cluster_id].add(chunk_index)
                self._duplicates_found += 1
                return cluster_id
        
        # No match - create new cluster
        if len(self._signature_to_cluster) < self._max_clusters:
            cluster_id = self._next_cluster_id
            self._next_cluster_id += 1
            
            self._signature_to_cluster[signature] = cluster_id
            self._cluster_chunks[cluster_id].add(chunk_index)
            self._prefix_index[prefix].add(cluster_id)
            self._clusters_created += 1
        
        return None  # First occurrence is not considered redundant
    
    def get_cluster_size(self, cluster_id: int) -> int:
        """Get number of chunks in a cluster"""
        return len(self._cluster_chunks.get(cluster_id, set()))
    
    def get_all_duplicates(self) -> List[Set[int]]:
        """Get all redundancy clusters with 2+ chunks"""
        return [
            chunks for chunks in self._cluster_chunks.values()
            if len(chunks) > 1
        ]
    
    def estimate_savings(self, chunk_size: int) -> int:
        """Estimate bytes saved from deduplication"""
        total_saved = 0
        for chunks in self._cluster_chunks.values():
            if len(chunks) > 1:
                # Each duplicate beyond first saves chunk_size bytes
                total_saved += (len(chunks) - 1) * chunk_size
        return total_saved
    
    def reset(self):
        """Reset predictor state"""
        self._signature_to_cluster.clear()
        self._cluster_chunks.clear()
        self._prefix_index.clear()
        self._next_cluster_id = 0
    
    def get_stats(self) -> dict:
        """Get predictor statistics"""
        total_chunks = sum(len(c) for c in self._cluster_chunks.values())
        redundant_chunks = sum(
            len(c) - 1 for c in self._cluster_chunks.values() if len(c) > 1
        )
        
        return {
            "predictions": self._predictions,
            "duplicates_found": self._duplicates_found,
            "clusters_created": self._clusters_created,
            "total_chunks_tracked": total_chunks,
            "redundant_chunks": redundant_chunks,
            "redundancy_ratio": redundant_chunks / total_chunks if total_chunks > 0 else 0,
        }


class SimHashRedundancyPredictor:
    """
    Alternative predictor using SimHash for fuzzy matching.
    
    Useful for near-duplicate detection where exact signatures differ slightly.
    """
    
    def __init__(self, hash_bits: int = 64, threshold: int = 4):
        self._hash_bits = hash_bits
        self._threshold = threshold  # Max Hamming distance for match
        
        # Hash -> cluster mapping
        self._hashes: Dict[int, int] = {}
        self._clusters: Dict[int, Set[int]] = defaultdict(set)
        self._next_cluster = 0
        
        self._predictions = 0
    
    def _string_to_simhash(self, signature: str) -> int:
        """Convert signature string to simhash"""
        # Use MD5 as base hash
        h = hashlib.md5(signature.encode()).digest()
        
        # Convert to integer
        result = 0
        for i in range(min(8, len(h))):
            result = (result << 8) | h[i]
        
        return result
    
    def _hamming_distance(self, a: int, b: int) -> int:
        """Compute Hamming distance between two hashes"""
        xor = a ^ b
        return bin(xor).count('1')
    
    def predict(self, signature: str, chunk_index: int) -> Optional[int]:
        """Predict cluster using SimHash"""
        self._predictions += 1
        
        sig_hash = self._string_to_simhash(signature)
        
        # Check for near matches
        for existing_hash, cluster_id in self._hashes.items():
            if self._hamming_distance(sig_hash, existing_hash) <= self._threshold:
                self._clusters[cluster_id].add(chunk_index)
                return cluster_id
        
        # New hash
        cluster_id = self._next_cluster
        self._next_cluster += 1
        self._hashes[sig_hash] = cluster_id
        self._clusters[cluster_id].add(chunk_index)
        
        return None
    
    def get_stats(self) -> dict:
        return {
            "predictions": self._predictions,
            "unique_hashes": len(self._hashes),
            "clusters": len(self._clusters),
        }
