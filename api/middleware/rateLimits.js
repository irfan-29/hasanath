// Rate limits for the paths that create side effects: sign-in, code emails and
// posts.
//
// Two dimensions wherever it applies, because they stop different attacks:
//
//   loginIpLimiter      - one source cannot spray guesses across many accounts.
//   loginAccountLimiter - many sources cannot focus on one account. The key is
//                         the account's email, resolved from either the email or
//                         the username the visitor typed, so alternating between
//                         the two does not double the budget.
//
// Only failures are counted (skipSuccessfulRequests): a person who signs in
// normally never approaches the limit, while a password-guessing loop trips it.
// Both counters live in Mongo through MongoRateLimitStore, since Vercel gives
// every invocation a fresh process and an in-memory counter would reset on each
// cold start.

const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { MongoRateLimitStore } = require("../utils/rateLimitStore.js");

const WINDOW_MS = 15 * 60 * 1000;

// A shared office/NAT address can legitimately produce several failed logins,
// so the IP ceiling is looser than the per-account one.
const IP_MAX_FAILURES = 30;

// Ten wrong passwords in fifteen minutes is far beyond a mistyping human and
// still short enough that a motivated guesser makes no progress.
const ACCOUNT_MAX_FAILURES = 10;

// Every limiter answers the same way, with a machine-readable wait so the client
// can say how long to pause instead of just "try later". `scope` says which
// limit fired; it helps while debugging and is harmless to expose.
function tooManyAttempts(scope, windowMs) {
    return function handler(req, res) {
        const resetTime = req.rateLimit && req.rateLimit.resetTime;
        const retryAfter = resetTime instanceof Date
            ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
            : Math.ceil(windowMs / 1000);
        res.status(429)
            .set("Retry-After", String(retryAfter))
            .json({ error: "rate-limited", scope, retryAfter });
    };
}

const loginIpLimiter = rateLimit({
    windowMs: WINDOW_MS,
    limit: IP_MAX_FAILURES,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new MongoRateLimitStore("login-ip:"),
    handler: tooManyAttempts("ip", WINDOW_MS)
});

const loginAccountLimiter = rateLimit({
    windowMs: WINDOW_MS,
    limit: ACCOUNT_MAX_FAILURES,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new MongoRateLimitStore("login-account:"),
    // resolveLoginIdentifier runs first and leaves both fields on the request.
    // An empty identifier falls back to the IP, using the helper the library
    // requires for IPv6 subnetting.
    keyGenerator: (req) => req.loginEmail || req.loginIdentifier || ipKeyGenerator(req.ip || ""),
    handler: tooManyAttempts("account", WINDOW_MS)
});

// --- One-time-code emails ---------------------------------------------------
//
// Sign-up, resend and forgot-password all make the server send mail. Their
// 30-second cooldown lives in the visitor's session, which anyone can drop by
// clearing cookies, so it cannot be the only guard: a loop could mail-bomb an
// address and burn the Resend quota. These counters are keyed on the recipient
// and the source IP and stored in Mongo, so a fresh session changes nothing.
//
// Every request counts here, successful send or not. The emails are the scarce
// resource, and counting the request (not the delivery) keeps the check a
// single atomic increment before any work happens.
const OTP_WINDOW_MS = 60 * 60 * 1000;

// Five messages an hour still allows a sign-up plus a few resends, while
// capping what one address can be made to receive.
const OTP_EMAIL_MAX = 5;

// A shared connection can hold several people signing up; the per-address cap
// is what actually protects an inbox.
const OTP_IP_MAX = 20;

// The address a code-email route is about to write to: the form field for
// register/forgot, the pending sign-up for resend (which has no body field).
function resolveOtpTarget(req, res, next) {
    const body = req.body || {};
    const pending = (req.session && req.session.pendingSignup) || {};
    req.emailTarget = String(body.email || pending.email || "").trim().toLowerCase();
    return next();
}

const otpIpLimiter = rateLimit({
    windowMs: OTP_WINDOW_MS,
    limit: OTP_IP_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new MongoRateLimitStore("otp-ip:"),
    handler: tooManyAttempts("otp-ip", OTP_WINDOW_MS)
});

const otpEmailLimiter = rateLimit({
    windowMs: OTP_WINDOW_MS,
    limit: OTP_EMAIL_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new MongoRateLimitStore("otp-email:"),
    keyGenerator: (req) => req.emailTarget || ipKeyGenerator(req.ip || ""),
    handler: tooManyAttempts("otp-email", OTP_WINDOW_MS)
});

// --- Posts ------------------------------------------------------------------
//
// Every published post fans out to every Telegram subscriber, so the cost of one
// post is not the size of the request - it is the size of the audience. Five an
// hour is more than a person reflecting needs and far below what a spam loop
// wants. Posting needs a signed-in account, so the limits are per account;
// there is no per-IP limit, which could only punish people sharing a network.
//
// Only successful posts count (skipFailedRequests): a rejected empty post never
// reached anybody, so it should not spend the allowance.
const POST_WINDOW_MS = 60 * 60 * 1000;
const POST_ACCOUNT_MAX = 5;

// A minimum gap between posts, so an account cannot spend its whole hourly
// allowance as one burst. Without it, five posts in five seconds is five
// broadcasts to every subscriber, which is still spam even if the hour then
// goes quiet. One a minute is invisible to a person writing a reflection.
const POST_GAP_MS = 60 * 1000;

const postAccountLimiter = rateLimit({
    windowMs: POST_WINDOW_MS,
    limit: POST_ACCOUNT_MAX,
    skipFailedRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new MongoRateLimitStore("post-account:"),
    // requireLogin runs before this limiter, so an account id is always present.
    // The fallback keeps a misordered mount failing closed on the IP rather than
    // sharing one "undefined" bucket between every visitor.
    keyGenerator: (req) => (req.user && req.user._id ? String(req.user._id) : ipKeyGenerator(req.ip || "")),
    handler: tooManyAttempts("post-account", POST_WINDOW_MS)
});

const postGapLimiter = rateLimit({
    windowMs: POST_GAP_MS,
    limit: 1,
    skipFailedRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new MongoRateLimitStore("post-gap:"),
    keyGenerator: (req) => (req.user && req.user._id ? String(req.user._id) : ipKeyGenerator(req.ip || "")),
    handler: tooManyAttempts("post-gap", POST_GAP_MS)
});

const CONTACT_WINDOW_MS = 60 * 60 * 1000;
const CONTACT_ACCOUNT_MAX = 5;

const contactAccountLimiter = rateLimit({
    windowMs: CONTACT_WINDOW_MS,
    limit: CONTACT_ACCOUNT_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new MongoRateLimitStore("contact-account:"),
    keyGenerator: (req) => (req.user && req.user._id ? String(req.user._id) : ipKeyGenerator(req.ip || "")),
    handler: tooManyAttempts("contact-account", CONTACT_WINDOW_MS)
});

module.exports = {
    loginIpLimiter,
    loginAccountLimiter,
    otpIpLimiter,
    otpEmailLimiter,
    postAccountLimiter,
    postGapLimiter,
    contactAccountLimiter,
    resolveOtpTarget
};
