# Student Registration CSV Autocomplete

Updated behavior:

1. Room allocation and room number fields were removed from `student-register.html`.
2. The Student Name field searches `backend/database/students.csv`.
3. Typing the first letter (or more letters) calls:
   `GET /api/students/search?name=<prefix>`
4. Matching student names appear in a dropdown.
5. Clicking a student fills:
   - Student Name
   - Admission Number
   - Department
   - Year
   - Student Contact
   - Email
   - Parent Contact
   - Address
6. Password and ID Proof remain manual because passwords must not be exposed from the CSV and browsers do not allow a file input to be filled programmatically.
7. Room allocation is left for the later warden/hostel allocation workflow.

## Run

Start the backend from the `backend` folder:

```bash
node server.js
```

Then open the frontend through the same setup you normally use for this project.

The autocomplete expects the backend at:

`http://localhost:3000`


## If you see "Unable to load..."

1. Open a terminal in `updated_project/updateprj/backend`.
2. Run:
   `node server.js`
3. You should see:
   `Server running on http://localhost:3000`
4. In your browser, open:
   `http://localhost:3000/`
   You should get a JSON message saying the backend is running.
5. Keep that terminal open while using the registration page.


## Name display fix
The autocomplete API now returns `full_name`, so the dropdown displays the actual student name from `students.csv` instead of only admission number and department.
