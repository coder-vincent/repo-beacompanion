const userAuth = async (req, res, next) => {
  // Prefer cookie token, but also support "Authorization: Bearer <token>" header
  let token = req.cookies?.token;
  if (!token && req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
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
      return res.json({
        success: false,
        message: "Not authorized, login again.",
      });
    }

    next();
  } catch (err) {
    res.json({ success: false, message: "Not authorized, login again." });
  }
};
