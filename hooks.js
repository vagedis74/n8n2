/**
 * n8n Header-Based SSO Authentication Hook
 *
 * This hook enables trusted header authentication for n8n when used behind
 * Azure AD App Proxy or other identity-aware proxies.
 *
 * Azure AD App Proxy Headers:
 * - X-MS-TOKEN-AAD-ACCESS-TOKEN: Azure AD access token
 * - X-MS-CLIENT-PRINCIPAL-NAME: User Principal Name (UPN)
 * - X-MS-CLIENT-PRINCIPAL-ID: Azure AD Object ID
 * - X-Forwarded-Email: User's email address (user.mail)
 * - X-Forwarded-User: User's display name
 *
 * IMPORTANT: Ensure n8n is only accessible via the proxy to prevent header spoofing.
 */

// Header names (lowercase for HTTP header lookup)
const HEADERS = {
    email: (process.env.N8N_FORWARD_AUTH_HEADER || 'x-forwarded-email').toLowerCase(),
    upn: 'x-ms-client-principal-name',
    objectId: 'x-ms-client-principal-id',
    displayName: 'x-forwarded-user',
    accessToken: 'x-ms-token-aad-access-token',
};

// Auto-provisioning settings
const AUTO_PROVISION_ENABLED = process.env.N8N_SSO_AUTO_PROVISION !== 'false'; // Enabled by default
const DEFAULT_ROLE = process.env.N8N_SSO_DEFAULT_ROLE || 'global:member'; // global:admin, global:member

module.exports = {
    n8n: {
        ready: [
            async function () {
                // 'this' context contains dbCollections from n8n
                const userRepository = this.dbCollections.User;

                console.log('[SSO] Initializing header-based SSO hook...');
                console.log(`[SSO] Auto-provisioning: ${AUTO_PROVISION_ENABLED ? 'enabled' : 'disabled'}, default role: ${DEFAULT_ROLE}`);

                // Get the Express app from the Server instance via DI container
                let app;
                let authService;

                try {
                    const { Container } = require('@n8n/di');
                    const { Server } = require('/usr/local/lib/node_modules/n8n/dist/server.js');

                    const server = Container.get(Server);
                    app = server.app;

                    // Try to get AuthService for issuing cookies
                    try {
                        const { AuthService } = require('@n8n/backend-common');
                        authService = Container.get(AuthService);
                    } catch (e) {
                        console.log('[SSO] AuthService not available, will set req.user only');
                    }
                } catch (e) {
                    console.error('[SSO] Failed to get Express app:', e.message);
                    return;
                }

                if (!app) {
                    console.error('[SSO] Express app not found. Header SSO will not be enabled.');
                    return;
                }

                // Paths to skip authentication
                const skipPaths = [
                    '/healthz',
                    '/healthcheck',
                    '/metrics',
                    '/webhook',
                    '/webhook-test',
                    '/webhook-waiting',
                    '/rest/oauth2-credential',
                    '/assets',
                    '/favicon.ico',
                    '/rest/settings',
                    '/rest/sso',
                    '/rest/login',
                    '/rest/logout',
                    '/rest/mfa',
                    '/rest/forgot-password',
                    '/rest/resolve-signup-token',
                ];

                // Add middleware for header-based SSO
                // Use unshift to add at the beginning of the middleware stack
                const middleware = async (req, res, next) => {
                    try {
                        // Get path from url if req.path is not set yet
                        const path = req.path || req.url?.split('?')[0] || '';

                        // Skip if path should be excluded
                        const shouldSkip = skipPaths.some(p => path.startsWith(p));
                        if (shouldSkip) {
                            return next();
                        }

                        // Skip static assets
                        if (path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$/)) {
                            return next();
                        }

                        // Skip if already authenticated (has valid session)
                        if (req.user) {
                            return next();
                        }

                        // Debug: Log all incoming headers (remove in production)
                        if (process.env.N8N_SSO_DEBUG === 'true') {
                            const relevantHeaders = {};
                            for (const [key, value] of Object.entries(req.headers)) {
                                if (key.startsWith('x-') || key.includes('forward') || key.includes('auth')) {
                                    relevantHeaders[key] = value;
                                }
                            }
                            console.log(`[SSO DEBUG] Path: ${path}`);
                            console.log(`[SSO DEBUG] Headers:`, JSON.stringify(relevantHeaders, null, 2));
                        }

                        // Get user info from trusted headers
                        const email = req.headers[HEADERS.email];
                        const upn = req.headers[HEADERS.upn];
                        const objectId = req.headers[HEADERS.objectId];
                        const displayName = req.headers[HEADERS.displayName];

                        // Try email first, fall back to UPN
                        const lookupEmail = email || upn;
                        if (!lookupEmail) {
                            return next();
                        }

                        // Look up user by email
                        let user = await userRepository.findOne({
                            where: { email: lookupEmail.toLowerCase() },
                        });

                        // Auto-provision user if not found and enabled
                        if (!user && AUTO_PROVISION_ENABLED) {
                            try {
                                console.log(`[SSO] Auto-provisioning new user: ${lookupEmail}`);

                                // Verify the default role exists
                                const dataSource = userRepository.manager.connection;
                                const roleResult = await dataSource.query(
                                    'SELECT slug FROM role WHERE slug = $1 LIMIT 1',
                                    [DEFAULT_ROLE]
                                );

                                if (!roleResult || roleResult.length === 0) {
                                    console.error(`[SSO] Default role not found: ${DEFAULT_ROLE}`);
                                    return next();
                                }

                                // Parse display name into first/last name
                                const nameParts = (displayName || lookupEmail.split('@')[0]).split(' ');
                                const firstName = nameParts[0] || '';
                                const lastName = nameParts.slice(1).join(' ') || '';

                                // Create the new user with roleSlug
                                const newUser = userRepository.create({
                                    email: lookupEmail.toLowerCase(),
                                    firstName,
                                    lastName,
                                    roleSlug: DEFAULT_ROLE,
                                    disabled: false,
                                });

                                user = await userRepository.save(newUser);
                                console.log(`[SSO] Created new user: ${lookupEmail} (role: ${DEFAULT_ROLE})`);
                            } catch (provisionError) {
                                console.error(`[SSO] Failed to provision user: ${provisionError.message}`);
                                return next();
                            }
                        } else if (!user) {
                            console.log(`[SSO] User not found for email: ${lookupEmail} (objectId: ${objectId || 'N/A'})`);
                            return next();
                        }

                        // Store additional Azure AD info on request for potential use
                        req.azureAdInfo = {
                            email,
                            upn,
                            objectId,
                            displayName,
                        };

                        // Issue authentication cookie if AuthService is available
                        if (authService && authService.issueCookie) {
                            try {
                                await authService.issueCookie(res, user, req.browserId);
                            } catch (e) {
                                console.log('[SSO] Could not issue cookie:', e.message);
                            }
                        }

                        // Set the user on the request
                        req.user = user;

                        console.log(`[SSO] Authenticated user: ${lookupEmail} (${displayName || 'N/A'})`);
                        return next();
                    } catch (error) {
                        console.error('[SSO] Authentication error:', error.message);
                        return next();
                    }
                };

                // Force router initialization if needed
                if (app.lazyrouter) {
                    app.lazyrouter();
                }

                // Add middleware using app.use - it will be at the end but that's ok
                // because we need to handle the authentication differently
                // Instead, we'll use a request interceptor approach

                // Store the original handle function
                const originalHandle = app.handle.bind(app);

                // Override the handle function to inject our middleware first
                app.handle = function(req, res, callback) {
                    // Run our SSO middleware first
                    middleware(req, res, (err) => {
                        if (err) {
                            return callback(err);
                        }
                        // Then run the original handle
                        originalHandle(req, res, callback);
                    });
                };

                console.log('[SSO] Middleware injected via app.handle override');

                console.log(`[SSO] Header-based SSO enabled. Primary header: ${HEADERS.email}, fallback: ${HEADERS.upn}`);
            },
        ],
    },
};
