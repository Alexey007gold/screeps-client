---
"screeps-connectivity": patch
---

Namespace the pre-login `/api/authmod` session cache by host **and path**, not hostname alone. Behind `screeps-client-proxy` every backend is wrapped under one host (`localhost/(https://server)`), so hostname-only keys collided and one server's auth capabilities could be shown for another. Also disambiguates private servers that share a hostname on different ports. Matches the path-based namespacing already used for the persistent cache in `ScreepsClient`.
