# BeaCompanion - Render Deployment Guide

This guide explains how to deploy BeaCompanion to Render with both the Node.js server and Python ML capabilities.

## Prerequisites

1. A Render account (https://render.com)
2. Your code pushed to a GitHub repository
3. Database setup (PostgreSQL recommended)

## Deployment Steps

### 1. Create a PostgreSQL Database

1. In your Render dashboard, click "New +"
2. Select "PostgreSQL"
3. Configure:
   - Name: `beacompanion-db`
   - Database Name: `beacompanion`
   - User: `beacompanion_user`
   - Region: Choose closest to your users
4. Click "Create Database"
5. Note down the connection details

### 2. Deploy the Server

1. In Render dashboard, click "New +"
2. Select "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: `beacompanion-server`
   - **Environment**: `Node`
   - **Region**: Same as your database
   - **Branch**: `main` (or your default branch)
   - **Root Directory**: `server`
   - **Build Command**: `chmod +x build.sh && ./build.sh`
   - **Start Command**: `npm start`

### 3. Set Environment Variables

Add these environment variables in your Render service settings:

```
NODE_ENV=production
PORT=10000
DB_HOST=[Your PostgreSQL host from step 1]
DB_PORT=5432
DB_DATABASE=beacompanion
DB_USER=[Your PostgreSQL user from step 1]
DB_PASS=[Your PostgreSQL password from step 1]
DB_DIALECT=postgres
JWT_SECRET=[Generate a secure random string]
CLIENT_URL=[Your frontend URL if deploying separately]
```

### 4. Optional: Email Configuration

For email verification features, add:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=[Your email]
SMTP_PASS=[Your app password]
```

### 5. Deploy Frontend (Optional)

If deploying the frontend separately:

1. Create another Web Service
2. Set Root Directory to `client`
3. Build Command: `npm install && npm run build`
4. Start Command: `npm run preview` or use a static site service

## File Structure

The deployment includes:

- `/server` - Node.js backend
- `/server/ml-utils` - Python ML utilities
- `/server/ml-models` - Pre-trained models
- `/server/requirements.txt` - Python dependencies

## Python Dependencies

The following Python packages are installed:

- numpy, pandas, matplotlib
- scikit-learn, torch, torchvision
- opencv-python, mediapipe
- PIL (Pillow)

## Troubleshooting

### Build Issues

- Ensure the build script has execute permissions
- Check that both Node.js and Python dependencies install correctly
- Monitor build logs for specific error messages

### Database Connection Issues

- Verify all database environment variables are correct
- Ensure the database allows connections from your Render service
- Check that SSL is properly configured for production

### ML Model Issues

- Ensure model files are included in your repository
- Check that Python dependencies are compatible
- Monitor server logs for ML-related errors

## Monitoring

Monitor your deployment:

1. Check Render service logs
2. Monitor database connections
3. Test ML endpoints after deployment
4. Verify email functionality (if configured)

## Support

For deployment issues:

1. Check Render documentation
2. Review service logs
3. Verify environment variables
4. Test locally with production-like settings
