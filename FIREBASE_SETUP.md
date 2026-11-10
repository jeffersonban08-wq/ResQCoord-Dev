# Firebase setup

The app uses Firebase Authentication (email/password) and Cloud Firestore. The web config is in `Javascript/firebase-init.js`; Firebase web config is public and is not a service-account key.

## Finish Firebase setup

1. In **Firestore Database → Rules**, replace the rules with `firestore.rules` and click **Publish**. Do this before sharing the app.
2. In **Authentication → Users**, choose **Add user** and create the first administrator's email/password account.
3. Copy that user's **UID**. In Firestore, create a `users` collection document whose document ID is that exact UID. Add these fields:
   - `id` (string): the UID
   - `role` (string): `admin`
   - `name` (string): administrator's name
   - `org` (string): organization name
   - `email` (string): same email as the Authentication account
   - `createdAt` (string): an ISO date/time
4. Sign in through the app's administrator login. On the first admin sign-in, the app seeds its example data, including Team Alpha, Bravo, Charlie, and Delta. When upgrading the previous demo roster, it moves old Rescue 12 assignments to Charlie and Air Unit 2 assignments to Delta.
5. Responders can then register through the app and choose one of the four teams. Registration creates the selected predefined team record if it is missing; it cannot change an existing team. The current `firestore.rules` must be published first.

## Publish the web app with Firebase Hosting

The project is configured to host the existing HTML app at the project root and uses the Firebase project `resqcoord1`.

1. Install Node.js if it is not already installed.
2. From the project folder, run `npx firebase-tools login` and sign in with the Google account that owns this Firebase project.
3. Run `npx firebase-tools deploy --only hosting,firestore:rules`.
4. In Firebase Console, open **Authentication → Settings → Authorized domains** and ensure the Hosting domain `resqcoord1.web.app` is listed.
5. Open `https://resqcoord1.web.app`.

The Hosting deploy publishes the app and Firestore rules. Team documents are created or migrated the first time an administrator signs in to the hosted app; an administrator profile must already exist as described above.

Administrator registration is a separate access-request form. Requests are stored in Firestore's `adminRequests` collection and do not grant command-center access. The project owner can review and approve pending requests from `https://resqcoord1.web.app/owner-dashboard.html`, using the Firebase Authentication account with the owner UID configured in `Javascript/owner.js` and `firestore.rules`. Approval creates the user's `users/{uid}` administrator profile and removes the pending request together. Until this profile exists, admin sign-in is denied. Responders continue to register separately from the responder portal.

If the owner account changes, update its UID in both `Javascript/owner.js` and `firestore.rules`, then publish the Firestore rules again.

## Important

- Never enable Firestore **test mode** or publish rules that allow unrestricted reads/writes. The app includes location, incident, and SOS information.
- User profiles/passwords are now handled by Firebase Authentication; the app no longer stores password hashes in Firestore.
- The app needs an internet connection and access to `www.gstatic.com` for the Firebase SDK.
- Existing accounts and records stored in the old browser `localStorage` are not migrated automatically.
- Deploying Hosting requires signing in to Firebase CLI with an account that has permission to deploy to this Firebase project.
