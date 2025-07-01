import jwt from "jsonwebtoken";

// Get JWT secret with fallback
const getJwtSecret = () => {
  return (
    process.env.JWT_SECRET ||
    "beacompanion_jwt_secret_key_2024_secure_and_random"
  );
};

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
    console.error("Authentication error:", err);
    res.json({ success: false, message: "Not authorized, login again." });
  }
};

export default userAuth;
