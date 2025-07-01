#!/bin/bash

echo "🚀 Starting BeaCompanion Build Process..."

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Install Python dependencies for ML functionality
echo "🐍 Installing Python dependencies for ML functionality..."

# Set Python environment variables for better compatibility
export PYTHONDONTWRITEBYTECODE=1
export PYTHONUNBUFFERED=1

# Try to install Python dependencies with retry logic
install_python_deps() {
    echo "Attempting to install Python dependencies..."
    
    # Update pip to latest version
    python -m pip install --upgrade pip
    
    # Install dependencies with specific flags for Render compatibility
    python -m pip install -r requirements.txt \
        --no-cache-dir \
        --prefer-binary \
        --only-binary=all \
        --timeout=300 \
        --retries=3
    
    return $?
}

# Try installation with fallback
if install_python_deps; then
    echo "✅ Python ML dependencies installed successfully!"
    export ML_ENABLED=true
else
    echo "⚠️  Python ML installation failed, but continuing with build..."
    echo "Application will run with simulated ML responses."
    export ML_ENABLED=false
fi

echo "✅ Build process completed!" 