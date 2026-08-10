// Protect frontend routes
const token = localStorage.getItem('ledgerly_token');
const currentPath = window.location.pathname;

if (!token && !currentPath.includes('login.html')) {
    window.location.href = '/login.html';
}

// Global fetch interceptor to inject Authorization header
if (window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        let [resource, config] = args;
        
        // Skip auth for login route
        if (typeof resource === 'string' && resource.includes('/api/auth/login')) {
            return originalFetch.apply(this, args);
        }

        if (!config) {
            config = {};
        }
        
        // Preserve existing headers if using Headers object or basic object
        if (config.headers instanceof Headers) {
            if (localStorage.getItem('ledgerly_token')) {
                config.headers.set('Authorization', `Bearer ${localStorage.getItem('ledgerly_token')}`);
            }
        } else {
            if (!config.headers) {
                config.headers = {};
            }
            if (localStorage.getItem('ledgerly_token')) {
                config.headers['Authorization'] = `Bearer ${localStorage.getItem('ledgerly_token')}`;
            }
        }
        
        try {
            const response = await originalFetch(resource, config);
            // If API rejects token, force logout
            if (response.status === 401 || response.status === 403) {
                console.error('Authentication expired or invalid. Redirecting to login.');
                localStorage.removeItem('ledgerly_token');
                sessionStorage.clear();
                if (!currentPath.includes('login.html')) {
                    window.location.href = '/login.html';
                }
            }
            return response;
        } catch (err) {
            throw err;
        }
    };
}

// Optional manual logout function
window.logout = function() {
    localStorage.removeItem('ledgerly_token');
    window.location.href = '/login.html';
};
