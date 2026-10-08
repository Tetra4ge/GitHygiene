const { createRemoteJWKSet, jwtVerify } = require('jose');

// Supabase now issues session JWTs signed with an asymmetric key (ES256) by
// default — the "Legacy JWT Secret" shared-HMAC option is opt-in and, for this
// project, inactive. Verification therefore needs Supabase's public JWKS
// (its published verification keys), not a shared secret.
//
// createRemoteJWKSet caches the fetched key set and re-fetches automatically
// when it encounters an unrecognized `kid`, so key rotation on Supabase's side
// doesn't require a restart here.
let jwks;
const getJwks = () => {
  if (!jwks) {
    const jwksUrl = new URL('/auth/v1/.well-known/jwks.json', process.env.SUPABASE_URL);
    jwks = createRemoteJWKSet(jwksUrl);
  }
  return jwks;
};

const requireAuth = async (req, res, next) => {
  try {
    // 1. Get the token from the Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. No token provided.'
      });
    }

    const token = authHeader.split(' ')[1];

    // 2. Verify the token's signature against Supabase's published JWKS and
    //    confirm it was issued by this project (aud/iss checks reject tokens
    //    from a different Supabase project even if somehow signed validly).
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `${process.env.SUPABASE_URL}/auth/v1`,
      audience: 'authenticated'
    });

    // 3. Attach the decoded user payload to the request object
    req.user = payload;

    // 4. Move to the next middleware or route handler
    next();
  } catch (error) {
    console.error('JWT Verification Error:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.'
    });
  }
};

module.exports = { requireAuth };
