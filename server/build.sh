#!/bin/bash

echo "🚀 Starting BeaCompanion Build Process..."

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Only install Python dependencies if not in production or if explicitly requested
if [ "$SKIP_PYTHON" != "true" ]; then
    echo "🐍 Installing Python dependencies..."
    
    # Try to install Python requirements, but don't fail the build if it doesn't work
    if command -v python3 &> /dev/null; then
        echo "Using python3..."
        python3 -m pip install --upgrade pip
        python3 -m pip install -r requirements.txt || echo "⚠️  Python packages installation failed, continuing with Node.js only..."
    elif command -v python &> /dev/null; then
        echo "Using python..."
        python -m pip install --upgrade pip
        python -m pip install -r requirements.txt || echo "⚠️  Python packages installation failed, continuing with Node.js only..."
    else
        echo "⚠️  Python not found, skipping Python dependencies..."
    fi
else
    echo "⏭️  Skipping Python dependencies (SKIP_PYTHON=true)"
fi

echo "✅ Build process completed!" 