import { useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppContext } from "@/context/AppContext";

const ProtectedRoute = ({ children }) => {
  const { isLoggedIn, userData } = useContext(AppContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoggedIn === false) {
      console.log("User not authenticated, redirecting to login");
      navigate("/login");
    }
  }, [isLoggedIn, navigate]);

  if (isLoggedIn === null || isLoggedIn === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (isLoggedIn && !userData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading user data...</p>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return null;
  }

  return children;
};

export default ProtectedRoute;
