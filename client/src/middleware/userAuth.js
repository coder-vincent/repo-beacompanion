const userAuth = async (req, res, next) => {
  // Prefer cookie token, but also support "Authorization: Bearer <token>" header
  let token = req.cookies?.token;
  if (!token && req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  console.log("🔐 userAuth: Checking authentication...");
  console.log("🔐 userAuth: Cookies received:", req.cookies);
  console.log("🔐 userAuth: Token found:", token ? "YES" : "NO");
  console.log("🔐 userAuth: Authorization header:", req.headers.authorization);

  if (!token) {
    console.log("❌ userAuth: No token found");
    return res.json({
      success: false,
      message: "Not authorized, login again.",
    });
  }

  try {
    const tokenDecode = jwt.verify(token, getJwtSecret());
    console.log(
      "✅ userAuth: Token decoded successfully, user ID:",
      tokenDecode.id
    );

    if (tokenDecode.id) {
      req.user = { id: tokenDecode.id };
    } else {
      console.log("❌ userAuth: No user ID in token");
      return res.json({
        success: false,
        message: "Not authorized, login again.",
      });
    }

    next();
  } catch (err) {
    console.error("❌ userAuth: Authentication error:", err);
    res.json({ success: false, message: "Not authorized, login again." });
  }
};
