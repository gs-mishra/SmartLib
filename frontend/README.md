# 📚 Smart Library Portal (QR-Based)

A premium, state-of-the-art Single Page Web Application (SPA) designed to manage smart libraries using dynamic **QR Codes** for book cataloging and member verification. The platform connects directly to a **Supabase PostgreSQL** cloud database for real-time relational data sync, and features an offline **LocalStorage fallback** for immediate local sandbox testing.

---

## ✨ Key Features

### 🌟 High-Fidelity visual UI
* **Glassmorphic Aesthetics**: Designed with modern tailwind-inspired translucent sheets, backdrop blurs, customizable border frames, and subtle glowing highlights.
* **Responsive Layouts**: Features a flexible sidebar dashboard layout that folds into an icons-only sidebar on tablet and mobile viewports.
* **Micro-Animations**: Custom hover transformations, floating analytics stat cards, pulsing scanner frames, and sleek toast alerts instead of boring browser alerts.

### 🛡️ Role-Based Logins
* **Register Library**: Admins can initialize a new library entity by establishing a name and set of primary administrator login credentials.
* **Librarian / Admin Login**: Opens dashboard access to manage books, student memberships, checkout operations, and system policies.
* **Student / Member Login**: Opens student portal to browse catalog, get personal scan code, and audit borrowing history/fines. Students cannot register themselves; only admins can add student accounts.

### 📖 Catalog & Member Registries
* **Manage Books (CRUD)**: Add, edit, search, and delete book entries (Titles, Authors, Genres, ISBNs). Generates high-resolution QR codes for each catalog item.
* **Manage Students (CRUD)**: Register members with name, email, username, and password. Tracks active checkouts and fines per member, and generates their member QR codes.

### 🔄 Checkout & Return Desk (QR Integration)
* **Webcam Camera Scanner**: Integrates a real-time viewport via `html5-qrcode` to decode physical codes using your camera.
* **Image File Upload**: Decodes static QR image files directly from a file browser.
* **Offline Scanner Simulator**: Allows testing full scan checkout events in a click without needing cameras or stickers.
* **Autocompletes**: Smart live matching suggestions when typing in the issue desks.
* **Resilient Mismatch Fallback**: The desk automatically resolves inputs; if the librarian inputs a Student **Username** or Book **ISBN** instead of a database ID, the backend resolves the ID for them automatically.
* **Overdue Fine System**: Automatically computes overdue fines based on the due date and daily fine rate (configurable in settings).

---

## 📁 Repository Structure
```
e:\Smart Library\
├── index.html              # Main SPA container and layouts
├── README.md               # Repository documentation
├── SUPABASE_SETUP.md       # Step-by-step Supabase PostgreSQL setup guide
├── SUPABASE_SCHEMA.sql     # SQL DDL table creation queries for Supabase SQL Editor
├── css/
│   └── styles.css          # Design system styling tokens & visual rules
└── js/
    ├── supabase-config.js  # App credentials & active Supabase client keys
    ├── supabase-db.js      # Universal Database Adapter (Supabase PostgREST vs LocalStorage)
    ├── qr-handler.js       # QR Code generation and webcam reader bindings
    └── app.js              # Application state router and form action events
```

---

## ⚡ Quick Start

### 1. Run the Portal
Double-click `index.html` or serve the project directory using a local web server (e.g. `npx http-server` or Live Server extension). The app runs purely on the client side—no local database setup or compilation is required!

### 2. Configure Supabase Database (Already Configured!)
Your project is pre-configured with active Supabase credentials inside `js/supabase-config.js`. 
To migrate or set up your own database tables:
1. Log in to the [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to the **SQL Editor**, open **[SUPABASE_SCHEMA.sql](file:///e:/Smart%20Library/SUPABASE_SCHEMA.sql)**, copy the script, paste it into the editor, and click **Run**.
3. Set your custom project keys inside `js/supabase-config.js` if you are using your own Supabase project.

*For detailed instructions, see [SUPABASE_SETUP.md](file:///e:/Smart%20Library/SUPABASE_SETUP.md).*

---

## 🛠️ Third-Party Dependencies
All libraries are loaded via reliable CDNs so you don't need `npm install`:
- **QR Code Generation**: [QRCode.js](https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js)
- **Webcam QR Decoding**: [html5-qrcode](https://unpkg.com/html5-qrcode)
- **Dashboard Icons**: [FontAwesome 6.4](https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css)
- **Database Engine**: [Supabase JS Client SDK v2](https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2)

## Holiday Management update

- Admin dashboard now includes **Holiday Management**, with a month calendar and saved holiday list.
- When issuing a book, the calculated due date moves forward when it falls on Saturday, Sunday, or a holiday saved for that library. The date is adjusted at issue time; existing issue records are not rewritten.
- Holidays are stored per library in Supabase, or in browser LocalStorage when running in local mode.

### Existing Supabase database

If your Supabase database already exists, open the Supabase SQL Editor and run `SUPABASE_HOLIDAYS_MIGRATION.sql` once. For a new database, use the updated `SUPABASE_SCHEMA.sql`.

### Quick test

1. Log in as an admin and open **Holiday Management**.
2. Add a holiday date and name. Confirm it appears in the calendar and saved list.
3. Issue a book with a duration that makes its due date fall on that holiday. Confirm the due date is the next non-weekend, non-holiday date.
4. Repeat with a Saturday/Sunday due date, then remove a holiday and test again.
5. Test the calendar, form, and remove button on a narrow mobile screen.

Note: Holiday rules affect newly created issue records only. Existing records retain their current due dates.


### Default holiday calendar
The admin Holiday Management screen seeds suggested India/Gujarat festival holidays for the current year and next year the first time it is opened for a library. Admins can edit a saved holiday by selecting its date and saving a new name, or remove it. Dates marked “verify locally” and Islamic dates are suggestions only: festival dates can vary by regional calendar or moon sighting. Saturdays and Sundays are automatically skipped by due-date calculation; Sundays are shown as weekend days in the calendar and do not need individual holiday rows.
