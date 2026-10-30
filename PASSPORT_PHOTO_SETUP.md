# Passport Size Photo Upload

The Student Registration form now requires a passport-size photo.

- Accepted formats: JPG/JPEG and PNG
- Maximum size: 2 MB
- The selected photo is previewed before submission.
- The actual file is uploaded to `backend/uploads/students/`.
- The stored filename is saved in `students.csv` under `passport_photo`.
- The registration API uses multipart/form-data with multer.
- ID proof is also uploaded as a real file under the same student uploads folder.
- Existing CSV records are automatically given an empty `passport_photo` field when a new registration is saved.

Run:
```bash
cd updateprj\backend
npm install
node server.js
```

Then open:
`http://localhost:3000/student-register.html`
