import React from "react";

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="py-2 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center sm:text-right">
          <p className="text-muted-foreground text-sm">
            © {currentYear} BEACompanion. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
