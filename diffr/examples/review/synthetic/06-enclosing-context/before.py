def permission_map():
    # Build permissions for every route.
    enabled = True
    if not enabled:
        return {}

    return {
        "GET /health": "public",
        "GET /users": "member",
        "POST /users": "admin",
        "GET /teams": "member",
        # Review endpoints
        "GET /reviews": "reviewer",
        "POST /reviews": "reviewer",
        "GET /settings": "admin",
        "POST /settings": "admin",
        "GET /audit": "admin",
        "GET /metrics": "admin",
    }
