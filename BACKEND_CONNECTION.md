# Student Backend Connection

Student registration, login, and dashboard are now connected to the Node.js backend.

## Start

From `updateprj/backend`:

```bash
npm install
node server.js
```

Then open:

`http://localhost:3000/student-login.html`

Do not open the HTML by double-clicking `file://...`; use the Node server URL.

## Flow

Student Registration -> `POST /api/students/register` -> `students.csv`

Student Login -> `POST /api/students/login` -> bcrypt password check + approval status

Student Dashboard -> `GET /api/students/profile/:login_id` -> current student data from `students.csv`

Student Name autocomplete -> `GET /api/students/search?name=S`

The dashboard redirects to login if there is no valid approved backend session.
