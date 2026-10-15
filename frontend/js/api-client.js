// Optional REST API client for pages/modules migrated to the Express API.
window.smartLibraryApi = {
  async request(path, options = {}) {
    const response = await fetch(`/api${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `API request failed (${response.status})`);
    }
    return response.status === 204 ? null : response.json();
  },
  health() {
    return this.request("/health");
  },
  libraries() {
    return this.request("/libraries");
  },
  list(table, libraryId) {
    return this.request(
      `/${encodeURIComponent(table)}?library_id=${encodeURIComponent(libraryId)}`,
    );
  },
};
