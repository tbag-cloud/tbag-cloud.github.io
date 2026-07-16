# Bolt's Performance Journal

This journal documents critical, high-impact lessons learned while investigating and implementing optimizations in this codebase.

## 2023-11-20 - [Avoid redundant Supabase Storage API roundtrips for preview images]
**Learning:** Frequent API calls to `createSignedUrl` on every image click, preview load, or list rerender introduces severe network latency overhead and unnecessary resource utilization. By caching the signed URLs in memory during the signature lifetime, we eliminate duplicate network requests and provide instant feedback to the user on subsequent clicks/preview updates.
**Action:** Implemented a lightweight client-side `_signedUrlCache` Map with early expiration (90 seconds vs. the 120-second TTL) to ensure secure, correct, and extremely fast access to Supabase Storage signed resources.
