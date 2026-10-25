# Security Policy

## Supported versions

CampusConnect is a single web app that is deployed continuously from the `main` branch.
Only the latest version on `main` receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: open the **Security** tab of this repository and choose
**Report a vulnerability**. Include what you found, the steps to reproduce it, and which
part of the app it affects (for example Lost & Found, the sign-in flow or the Firestore rules).

What to expect:

- You will get an acknowledgement within 7 days.
- If the report is accepted, a fix is prepared on `main` and the Firestore rules or hosting are
  redeployed. You will be told when it is live.
- If it is declined (for example it is not reproducible or not a security issue), you will get
  a short explanation.

## Notes for people running their own copy

- The Firebase web configuration in `script.js` is not a secret, but it identifies a specific
  Firebase project. If you fork this app, replace it with **your own** Firebase project and
  publish `firestore.rules` to it. Do not use someone else's project.
- Never commit Firebase Admin or service-account private keys to this repository.
- Security is enforced by Firebase Authentication and the Firestore rules in `firestore.rules`,
  so always publish those rules before using the app with real students' data.
