# Deployment Guide: InvoiceGen

This guide provides step-by-step instructions on how to export your InvoiceGen application to GitHub and deploy it to a production environment.

## 1. Exporting to GitHub from AI Studio

To get your code into a GitHub repository:

1.  **Open Settings:** Click the **Settings** (⚙️ gear icon) in the top-right corner of the AI Studio Build interface.
2.  **Select Export:** Navigate to the **Export** tab.
3.  **Choose GitHub:** Select the **GitHub** option.
4.  **Authorize & Select Repo:** Follow the prompts to authorize AI Studio to access your GitHub account. You can then choose an existing repository or create a new one.
5.  **Push Code:** Click **Export to GitHub**. AI Studio will commit and push your current application state to the repository.

## 2. Firebase Configuration (Production)

Since this application relies on Firebase for Authentication and Firestore, you need to ensure your production environment is correctly configured.

1.  **Firebase Console:** Go to [https://console.firebase.google.com/](https://console.firebase.google.com/).
2.  **Authentication:** 
    *   Go to **Build > Authentication**.
    *   Enable **Google** as a Sign-in provider.
    *   **Authorized Domains:** Go to the **Settings** tab within Authentication, select **Authorized domains**, and add your Vercel deployment URL (e.g., `your-app.vercel.app`). This is **CRITICAL** for Google Login to work on your deployed site.
3.  **Firestore Database:**
    *   Go to **Build > Firestore Database**.
    *   Ensure your database is created in your preferred region.
4.  **Security Rules:**
    *   Copy the contents of `firestore.rules` from this project.
    *   Paste them into the **Rules** tab in the Firebase Firestore console and click **Publish**.

## 3. Environment Variables

Your application uses a `firebase-applet-config.json` file for configuration. In a production environment (like Vercel or Netlify), it is best practice to use Environment Variables instead of a static JSON file for sensitive keys.

### Recommended Environment Variables:

If you choose to refactor the code to use standard environment variables, you should set these in your hosting provider's dashboard:

*   `VITE_FIREBASE_API_KEY`
*   `VITE_FIREBASE_AUTH_DOMAIN`
*   `VITE_FIREBASE_PROJECT_ID`
*   `VITE_FIREBASE_APP_ID`
*   `VITE_FIREBASE_FIRESTORE_DB_ID`

## 4. Deploying the Application

### Option A: Vercel (Recommended)

1.  Log in to [Vercel](https://vercel.com/) and click **Add New > Project**.
2.  Import your GitHub repository.
3.  Vercel will automatically detect the Vite configuration.
4.  Click **Deploy**.

### Option B: Netlify

1.  Log in to [Netlify](https://www.netlify.com/) and click **Add new site > Import from GitHub**.
2.  Select your repository.
3.  Set the build command to `npm run build` and the publish directory to `dist`.
4.  Click **Deploy site**.

## 5. Local Development

To run the project locally after cloning from GitHub:

1.  Install dependencies: `npm install`
2.  Start the development server: `npm run dev`
3.  Open [http://localhost:3000](http://localhost:3000) in your browser.

---

**Note:** Ensure that any third-party libraries used (like `jspdf` and `html2canvas`) are correctly installed via `package.json`.
