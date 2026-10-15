// supabase-db.js
// Supabase Database Wrapper for Smart Library
// Implements client CRUD and transparently falls back to LocalStorage when Supabase config is default.

// Helper function to hash passwords client-side using browser-native SHA-256
async function hashPassword(password) {
  if (!password) return "";
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

class SupabaseLibraryDB {
  constructor() {
    this.isSupabase = false;
    this.client = null;
    this.init();
  }

  init() {
    // Prevent duplicate Supabase clients in the same browser context.
    if (this.client || this.isSupabase) return this;

    if (window.isSupabaseConfigured && window.isSupabaseConfigured()) {
      try {
        if (typeof supabase !== 'undefined') {
          // Initialize Supabase Client
          this.client = supabase.createClient(window.supabaseConfig.url, window.supabaseConfig.anonKey);
          this.isSupabase = true;
          console.log("SupabaseLibraryDB: Connected to Supabase Cloud Database.");
        } else {
          console.warn("SupabaseLibraryDB: Supabase SDK not found. Falling back to LocalStorage.");
        }
      } catch (err) {
        console.error("SupabaseLibraryDB: Failed to initialize Supabase:", err);
      }
    } else {
      console.log("SupabaseLibraryDB: Running in Local Database Mode (LocalStorage).");
    }

    // Initialize LocalStorage empty tables if they don't exist
    if (!this.isSupabase) {
      if (!localStorage.getItem('smart_lib_libraries')) {
        localStorage.setItem('smart_lib_libraries', JSON.stringify([]));
      }
      if (!localStorage.getItem('smart_lib_books')) {
        localStorage.setItem('smart_lib_books', JSON.stringify([]));
      }
      if (!localStorage.getItem('smart_lib_members')) {
        localStorage.setItem('smart_lib_members', JSON.stringify([]));
      }
      if (!localStorage.getItem('smart_lib_issues')) {
        localStorage.setItem('smart_lib_issues', JSON.stringify([]));
      }
      if (!localStorage.getItem('smart_lib_settings')) {
        localStorage.setItem('smart_lib_settings', JSON.stringify([]));
      }
    }
  }

  // --- HELPER STORAGE UPLOAD OPERATION ---
  async uploadFile(bucketName, filePath, file) {
    if (!this.isSupabase) return null;
    try {
      const { data, error } = await this.client.storage
        .from(bucketName)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type
        });
      if (error) throw error;

      const { data: { publicUrl } } = this.client.storage
        .from(bucketName)
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (err) {
      console.error(`Error uploading to bucket ${bucketName}:`, err);
      throw new Error(`Failed to upload image to bucket ${bucketName}: ${err.message}`);
    }
  }

  // --- HELPER LOCALSTORAGE OPERATIONS ---
  _getLocal(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || [];
    } catch {
      return [];
    }
  }

  _setLocal(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  // --- LIBRARIES ---
  async getLibraries() {
    // Prefer the Express REST API when the frontend is served by the Node.js backend.
    // This lets the login dropdown use the same Supabase connection that was verified
    // at /api/libraries, instead of failing silently due to browser-side RLS permissions.
    try {
      const response = await fetch('/api/libraries', {
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        const rows = await response.json();
        if (!Array.isArray(rows)) {
          throw new Error('The libraries API returned an unexpected response.');
        }
        return rows.map(l => ({
          id: l.id,
          name: l.name,
          adminUsername: l.admin_username,
          // The API intentionally does not return password hashes.
          adminPassword: undefined,
          imageUrl: l.image_url,
          libraryCode: l.library_code,
          createdAt: l.created_at
        }));
      }

      // A configured API returning an error should be visible in the console.
      console.warn(`Libraries REST API returned HTTP ${response.status}; trying configured fallback.`);
    } catch (apiError) {
      console.warn('Could not load libraries from the REST API; trying configured fallback.', apiError);
    }

    if (this.isSupabase) {
      const { data, error } = await this.client
        .from('libraries')
        .select('*')
        .order('name');

      if (error) {
        console.error('Supabase getLibraries error:', error);
        throw error;
      }

      return (data || []).map(l => ({
        id: l.id,
        name: l.name,
        adminUsername: l.admin_username,
        adminPassword: l.admin_password,
        imageUrl: l.image_url,
        libraryCode: l.library_code,
        createdAt: l.created_at
      }));
    }

    return this._getLocal('smart_lib_libraries');
  }

  async registerLibrary(name, adminUsername, adminPassword, libraryCode, imageFile = null) {
    const usernameClean = adminUsername.trim().toLowerCase();
    const codeClean = libraryCode.trim();

    if (!/^[0-9]{4}$/.test(codeClean)) {
      throw new Error("Library Code must be exactly 4 digits.");
    }

    const hashedPassword = await hashPassword(adminPassword);

    if (this.isSupabase) {
      // Check duplicate admin username
      const { data: existingUser } = await this.client
        .from('libraries')
        .select('id')
        .eq('admin_username', usernameClean)
        .maybeSingle();

      if (existingUser) {
        throw new Error("Admin username already taken.");
      }

      // Check duplicate library code
      const { data: existingCode } = await this.client
        .from('libraries')
        .select('id')
        .eq('library_code', codeClean)
        .maybeSingle();

      if (existingCode) {
        throw new Error("Library code already registered.");
      }

      // 1. Upload Library Image if provided
      let imageUrl = null;
      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${fileExt}`;
        imageUrl = await this.uploadFile('library_images', fileName, imageFile);
      }

      // 2. Insert Library Row
      const newLibRow = {
        name: name.trim(),
        admin_username: usernameClean,
        admin_password: hashedPassword,
        library_code: codeClean,
        image_url: imageUrl
      };

      const { data, error } = await this.client
        .from('libraries')
        .insert(newLibRow)
        .select()
        .single();

      if (error) throw error;

      // 3. Initialize Default Settings for this library
      const defaultSettings = {
        library_id: data.id,
        fine_per_day: 1.0,
        due_days_limit: 14
      };
      await this.client.from('settings').insert(defaultSettings);

      return {
        id: data.id,
        name: data.name,
        adminUsername: data.admin_username,
        adminPassword: data.admin_password,
        imageUrl: data.image_url,
        libraryCode: data.library_code,
        createdAt: data.created_at
      };
    } else {
      // LocalStorage Mode
      const libs = this._getLocal('smart_lib_libraries');
      if (libs.some(l => l.adminUsername === usernameClean)) {
        throw new Error("Admin username already taken.");
      }
      if (libs.some(l => l.libraryCode === codeClean)) {
        throw new Error("Library code already registered.");
      }

      let imageUrl = null;
      if (imageFile) {
        // Convert to base64 for localstorage mockup
        imageUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(imageFile);
        });
      }

      const newLib = {
        id: 'lib_' + Math.random().toString(36).substr(2, 9),
        name: name.trim(),
        adminUsername: usernameClean,
        adminPassword: hashedPassword,
        libraryCode: codeClean,
        imageUrl: imageUrl,
        createdAt: new Date().toISOString()
      };
      libs.push(newLib);
      this._setLocal('smart_lib_libraries', libs);

      // Create LocalStorage Settings
      const settingsList = this._getLocal('smart_lib_settings');
      settingsList.push({
        library_id: newLib.id,
        fine_per_day: 1.0,
        due_days_limit: 14
      });
      this._setLocal('smart_lib_settings', settingsList);

      return newLib;
    }
  }

  // --- LOGIN ---
  async loginUser(libraryId, username, password, role) {
    const usernameClean = username.trim().toLowerCase();
    const hashedPassword = await hashPassword(password);

    if (this.isSupabase) {
      if (role === 'admin') {
        const { data, error } = await this.client
          .from('libraries')
          .select('*')
          .eq('id', libraryId)
          .maybeSingle();

        if (error || !data) throw new Error("Library or admin account not found.");

        if (data.admin_username === usernameClean && data.admin_password === hashedPassword) {
          return {
            id: data.id,
            libraryId: data.id,
            libraryName: data.name,
            username: data.admin_username,
            name: "Librarian Admin",
            imageUrl: data.image_url,
            libraryCode: data.library_code,
            role: "admin"
          };
        } else {
          throw new Error("Invalid admin credentials.");
        }
      } else {
        // Student login
        const { data, error } = await this.client
          .from('members')
          .select('*')
          .eq('library_id', libraryId)
          .eq('username', usernameClean)
          .maybeSingle();

        if (error || !data) throw new Error("Student account not found.");

        if (data.password === hashedPassword) {
          // Fetch Library details
          const { data: libData } = await this.client
            .from('libraries')
            .select('name, library_code')
            .eq('id', libraryId)
            .single();

          return {
            id: data.id,
            libraryId: libraryId,
            libraryName: libData ? libData.name : "Library",
            libraryCode: libData ? libData.library_code : "CEN",
            memberIdCustom: data.member_id_custom,
            username: data.username,
            name: data.name,
            email: data.email,
            mobile: data.mobile,
            address: data.address,
            qrCodeUrl: data.qr_code_url,
            joinDate: data.join_date,
            role: "student"
          };
        } else {
          throw new Error("Incorrect password.");
        }
      }
    } else {
      // LocalStorage Mode
      const libs = this._getLocal('smart_lib_libraries');
      const lib = libs.find(l => l.id === libraryId);
      if (!lib) throw new Error("Library not found.");

      if (role === 'admin') {
        if (lib.adminUsername === usernameClean && lib.adminPassword === hashedPassword) {
          return {
            id: lib.id,
            libraryId: lib.id,
            libraryName: lib.name,
            username: lib.adminUsername,
            name: "Librarian Admin",
            imageUrl: lib.imageUrl,
            libraryCode: lib.libraryCode,
            role: "admin"
          };
        } else {
          throw new Error("Invalid admin credentials.");
        }
      } else {
        const members = this._getLocal('smart_lib_members');
        const member = members.find(m => m.libraryId === libraryId && m.username === usernameClean);
        if (!member) throw new Error("Student account not found.");
        if (member.password === hashedPassword) {
          return {
            id: member.id,
            libraryId: libraryId,
            libraryName: lib.name,
            libraryCode: lib.libraryCode,
            memberIdCustom: member.memberIdCustom,
            username: member.username,
            name: member.name,
            email: member.email,
            mobile: member.mobile,
            address: member.address,
            qrCodeUrl: member.qrCodeUrl,
            joinDate: member.joinDate,
            role: "student"
          };
        } else {
          throw new Error("Incorrect password.");
        }
      }
    }
  }

  // --- SYSTEM SETTINGS ---
  async getSettings(libraryId) {
    if (this.isSupabase) {
      const { data, error } = await this.client
        .from('settings')
        .select('*')
        .eq('library_id', libraryId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        // Create if missing
        const defaultSettings = { library_id: libraryId, fine_per_day: 1.0, due_days_limit: 14 };
        await this.client.from('settings').insert(defaultSettings);
        return {
          finePerDay: 1.0,
          dueDaysLimit: 14
        };
      }
      return {
        finePerDay: parseFloat(data.fine_per_day),
        dueDaysLimit: parseInt(data.due_days_limit)
      };
    } else {
      const settingsList = this._getLocal('smart_lib_settings');
      let item = settingsList.find(s => s.library_id === libraryId);
      if (!item) {
        item = { library_id: libraryId, fine_per_day: 1.0, due_days_limit: 14 };
        settingsList.push(item);
        this._setLocal('smart_lib_settings', settingsList);
      }
      return {
        finePerDay: item.fine_per_day,
        dueDaysLimit: item.due_days_limit
      };
    }
  }

  async updateSettings(libraryId, finePerDay, dueDaysLimit) {
    const fineRate = parseFloat(finePerDay);
    const dayLimit = parseInt(dueDaysLimit);

    if (this.isSupabase) {
      const { error } = await this.client
        .from('settings')
        .upsert({
          library_id: libraryId,
          fine_per_day: fineRate,
          due_days_limit: dayLimit
        });
      if (error) throw error;
      return true;
    } else {
      const settingsList = this._getLocal('smart_lib_settings');
      const idx = settingsList.findIndex(s => s.library_id === libraryId);
      if (idx !== -1) {
        settingsList[idx].fine_per_day = fineRate;
        settingsList[idx].due_days_limit = dayLimit;
      } else {
        settingsList.push({ library_id: libraryId, fine_per_day: fineRate, due_days_limit: dayLimit });
      }
      this._setLocal('smart_lib_settings', settingsList);
      return true;
    }
  }

  // --- BOOKS ---
  async getBooks(libraryId) {
    if (this.isSupabase) {
      const { data, error } = await this.client
        .from('books')
        .select('*')
        .eq('library_id', libraryId)
        .order('title');

      if (error) throw error;

      return data.map(b => ({
        id: b.id,
        libraryId: b.library_id,
        title: b.title,
        author: b.author || 'N/A',
        isbn: b.isbn || 'N/A',
        barcode: b.barcode || 'N/A',
        coverUrl: b.cover_url,
        shelfLocation: b.shelf_location || 'N/A',
        totalCopies: parseInt(b.total_copies || 1),
        availableCopies: parseInt(b.available_copies || 1),
        createdAt: b.created_at
      }));
    } else {
      const books = this._getLocal('smart_lib_books');
      return books.filter(b => b.libraryId === libraryId);
    }
  }

  async addBook(libraryId, bookData, coverFile = null) {
    const barcodeClean = bookData.barcode ? bookData.barcode.trim() : null;

    if (this.isSupabase) {
      // Check unique barcode in this library
      if (barcodeClean) {
        const { data: existing } = await this.client
          .from('books')
          .select('id')
          .eq('library_id', libraryId)
          .eq('barcode', barcodeClean)
          .maybeSingle();

        if (existing) {
          throw new Error("A book with this Barcode is already registered.");
        }
      }

      // Upload Cover file if provided
      let coverUrl = null;
      if (coverFile) {
        const fileExt = coverFile.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${fileExt}`;
        coverUrl = await this.uploadFile('book_covers', fileName, coverFile);
      }

      const totalCopies = parseInt(bookData.totalCopies || 1);

      const bookRow = {
        library_id: libraryId,
        title: bookData.title.trim(),
        author: bookData.author ? bookData.author.trim() : null,
        isbn: bookData.isbn ? bookData.isbn.trim() : null,
        barcode: barcodeClean,
        cover_url: coverUrl,
        shelf_location: bookData.shelfLocation ? bookData.shelfLocation.trim() : 'N/A',
        total_copies: totalCopies,
        available_copies: totalCopies // Initially all copies are available
      };

      const { data, error } = await this.client
        .from('books')
        .insert(bookRow)
        .select()
        .single();

      if (error) throw error;

      return {
        id: data.id,
        libraryId: data.library_id,
        title: data.title,
        author: data.author,
        isbn: data.isbn,
        barcode: data.barcode,
        coverUrl: data.cover_url,
        shelfLocation: data.shelf_location,
        totalCopies: data.total_copies,
        availableCopies: data.available_copies,
        createdAt: data.created_at
      };
    } else {
      // LocalStorage Mode
      const books = this._getLocal('smart_lib_books');
      if (barcodeClean && books.some(b => b.libraryId === libraryId && b.barcode === barcodeClean)) {
        throw new Error("A book with this Barcode is already registered.");
      }

      let coverUrl = null;
      if (coverFile) {
        coverUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(coverFile);
        });
      }

      const totalCopies = parseInt(bookData.totalCopies || 1);
      const bookObj = {
        id: 'book_' + Math.random().toString(36).substr(2, 9),
        libraryId,
        title: bookData.title.trim(),
        author: bookData.author ? bookData.author.trim() : 'N/A',
        isbn: bookData.isbn ? bookData.isbn.trim() : 'N/A',
        barcode: barcodeClean,
        coverUrl: coverUrl,
        shelfLocation: bookData.shelfLocation ? bookData.shelfLocation.trim() : 'N/A',
        totalCopies: totalCopies,
        availableCopies: totalCopies,
        createdAt: new Date().toISOString()
      };
      books.push(bookObj);
      this._setLocal('smart_lib_books', books);
      return bookObj;
    }
  }

  async updateBook(libraryId, bookId, bookData, coverFile = null) {
    const barcodeClean = bookData.barcode ? bookData.barcode.trim() : null;

    if (this.isSupabase) {
      // Fetch existing book record
      const { data: oldBook, error: fetchErr } = await this.client
        .from('books')
        .select('*')
        .eq('id', bookId)
        .eq('library_id', libraryId)
        .single();

      if (fetchErr || !oldBook) throw new Error("Book record not found.");

      // Check duplicate barcode
      if (barcodeClean && barcodeClean !== oldBook.barcode) {
        const { data: existing } = await this.client
          .from('books')
          .select('id')
          .eq('library_id', libraryId)
          .eq('barcode', barcodeClean)
          .maybeSingle();

        if (existing) {
          throw new Error("A book with this Barcode is already registered.");
        }
      }

      // Cover upload
      let coverUrl = oldBook.cover_url;
      if (coverFile) {
        const fileExt = coverFile.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${fileExt}`;
        coverUrl = await this.uploadFile('book_covers', fileName, coverFile);
      }

      // Adjust availability according to new total copies
      const newTotal = parseInt(bookData.totalCopies || 1);
      const copiesDiff = newTotal - oldBook.total_copies;
      const newAvailable = Math.max(0, oldBook.available_copies + copiesDiff);

      const bookRow = {
        title: bookData.title.trim(),
        author: bookData.author ? bookData.author.trim() : null,
        isbn: bookData.isbn ? bookData.isbn.trim() : null,
        barcode: barcodeClean,
        cover_url: coverUrl,
        shelf_location: bookData.shelfLocation ? bookData.shelfLocation.trim() : 'N/A',
        total_copies: newTotal,
        available_copies: newAvailable
      };

      const { data, error } = await this.client
        .from('books')
        .update(bookRow)
        .eq('id', bookId)
        .eq('library_id', libraryId)
        .select()
        .single();

      if (error) throw error;

      return {
        id: data.id,
        libraryId: data.library_id,
        title: data.title,
        author: data.author,
        isbn: data.isbn,
        barcode: data.barcode,
        coverUrl: data.cover_url,
        shelfLocation: data.shelf_location,
        totalCopies: data.total_copies,
        availableCopies: data.available_copies,
        createdAt: data.created_at
      };
    } else {
      const books = this._getLocal('smart_lib_books');
      const idx = books.findIndex(b => b.id === bookId && b.libraryId === libraryId);
      if (idx !== -1) {
        const oldBook = books[idx];
        if (barcodeClean && barcodeClean !== oldBook.barcode && books.some(b => b.libraryId === libraryId && b.barcode === barcodeClean)) {
          throw new Error("A book with this Barcode is already registered.");
        }

        let coverUrl = oldBook.coverUrl;
        if (coverFile) {
          coverUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(coverFile);
          });
        }

        const newTotal = parseInt(bookData.totalCopies || 1);
        const copiesDiff = newTotal - oldBook.totalCopies;
        const newAvailable = Math.max(0, oldBook.availableCopies + copiesDiff);

        books[idx] = {
          ...oldBook,
          title: bookData.title.trim(),
          author: bookData.author ? bookData.author.trim() : 'N/A',
          isbn: bookData.isbn ? bookData.isbn.trim() : 'N/A',
          barcode: barcodeClean,
          coverUrl: coverUrl,
          shelfLocation: bookData.shelfLocation ? bookData.shelfLocation.trim() : 'N/A',
          totalCopies: newTotal,
          availableCopies: newAvailable
        };

        this._setLocal('smart_lib_books', books);
        return books[idx];
      }
      throw new Error("Book not found.");
    }
  }

  async deleteBook(libraryId, bookId) {
    if (this.isSupabase) {
      const { error } = await this.client
        .from('books')
        .delete()
        .eq('id', bookId)
        .eq('library_id', libraryId);
      if (error) throw error;
      return true;
    } else {
      let books = this._getLocal('smart_lib_books');
      books = books.filter(b => !(b.id === bookId && b.libraryId === libraryId));
      this._setLocal('smart_lib_books', books);
      return true;
    }
  }

  // --- MEMBERS ---
  async getMembers(libraryId) {
    if (this.isSupabase) {
      const { data, error } = await this.client
        .from('members')
        .select('*')
        .eq('library_id', libraryId)
        .order('name');

      if (error) throw error;

      return data.map(m => ({
        id: m.id,
        libraryId: m.library_id,
        memberIdCustom: m.member_id_custom,
        username: m.username,
        name: m.name,
        email: m.email || 'N/A',
        mobile: m.mobile || 'N/A',
        address: m.address || 'N/A',
        password: m.password,
        qrCodeUrl: m.qr_code_url,
        joinDate: m.join_date,
        createdAt: m.created_at
      }));
    } else {
      const members = this._getLocal('smart_lib_members');
      return members.filter(m => m.libraryId === libraryId);
    }
  }

  async addMember(libraryId, memberData) {
    const usernameClean = memberData.username.trim().toLowerCase();
    const mobileClean = memberData.mobile.trim();
    const emailClean = memberData.email.trim().toLowerCase();

    if (!/^[0-9]{10}$/.test(mobileClean)) {
      throw new Error("Mobile number must be exactly 10 digits.");
    }

    const hashedPassword = await hashPassword(memberData.password);

    if (this.isSupabase) {
      // 1. Uniqueness Checks
      const { data: existingUser } = await this.client
        .from('members')
        .select('id')
        .eq('username', usernameClean)
        .maybeSingle();

      if (existingUser) {
        throw new Error("Student username already exists.");
      }

      if (emailClean) {
        const { data: existingEmail } = await this.client
          .from('members')
          .select('id')
          .eq('email', emailClean)
          .maybeSingle();
        if (existingEmail) throw new Error("Email address already registered.");
      }

      // 2. Fetch Library Short Code
      let libCode = "1000";
      const { data: lib } = await this.client
        .from('libraries')
        .select('library_code')
        .eq('id', libraryId)
        .single();

      if (lib && lib.library_code) {
        libCode = lib.library_code.trim();
      }

      // 3. Generate Custom ID Sequence
      const { data: currentMembers } = await this.client
        .from('members')
        .select('member_id_custom')
        .eq('library_id', libraryId);

      let maxSeq = 0;
      if (currentMembers && currentMembers.length > 0) {
        currentMembers.forEach(m => {
          if (m.member_id_custom) {
            const seqPart = m.member_id_custom.slice(-4);
            const num = parseInt(seqPart, 10);
            if (!isNaN(num) && num > maxSeq) {
              maxSeq = num;
            }
          }
        });
      }

      const seq = maxSeq + 1;
      const seqStr = seq.toString().padStart(4, '0');
      const year = new Date().getFullYear();
      const memberIdCustom = `Lib${year}${libCode}${seqStr}`;

      // 4. Generate QR code link using qrserver API
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(memberIdCustom)}`;

      // 5. Insert Member
      const memberRow = {
        library_id: libraryId,
        member_id_custom: memberIdCustom,
        name: memberData.name.trim(),
        address: memberData.address ? memberData.address.trim() : null,
        mobile: mobileClean,
        email: emailClean,
        username: usernameClean,
        password: hashedPassword,
        qr_code_url: qrCodeUrl
      };

      const { data, error } = await this.client
        .from('members')
        .insert(memberRow)
        .select()
        .single();

      if (error) throw error;

      return {
        id: data.id,
        libraryId: data.library_id,
        memberIdCustom: data.member_id_custom,
        username: data.username,
        name: data.name,
        email: data.email,
        mobile: data.mobile,
        address: data.address,
        password: data.password,
        qrCodeUrl: data.qr_code_url,
        joinDate: data.join_date,
        createdAt: data.created_at
      };
    } else {
      // LocalStorage Mode
      const members = this._getLocal('smart_lib_members');
      const libs = this._getLocal('smart_lib_libraries');

      if (members.some(m => m.username === usernameClean)) {
        throw new Error("Student username already exists.");
      }
      if (members.some(m => m.email === emailClean)) {
        throw new Error("Email address already registered.");
      }

      const lib = libs.find(l => l.id === libraryId);
      const libCode = lib ? lib.libraryCode : "1000";

      const libMembers = members.filter(m => m.libraryId === libraryId);
      let maxSeq = 0;
      libMembers.forEach(m => {
        if (m.memberIdCustom) {
          const seqPart = m.memberIdCustom.slice(-4);
          const num = parseInt(seqPart, 10);
          if (!isNaN(num) && num > maxSeq) {
            maxSeq = num;
          }
        }
      });

      const seq = maxSeq + 1;
      const seqStr = seq.toString().padStart(4, '0');
      const year = new Date().getFullYear();
      const memberIdCustom = `Lib${year}${libCode}${seqStr}`;
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(memberIdCustom)}`;

      const memberObj = {
        id: 'mem_' + Math.random().toString(36).substr(2, 9),
        libraryId,
        memberIdCustom: memberIdCustom,
        name: memberData.name.trim(),
        username: usernameClean,
        email: emailClean,
        mobile: mobileClean,
        address: memberData.address ? memberData.address.trim() : null,
        password: hashedPassword,
        qrCodeUrl: qrCodeUrl,
        joinDate: new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString()
      };
      members.push(memberObj);
      this._setLocal('smart_lib_members', members);
      return memberObj;
    }
  }

  async updateMember(libraryId, memberId, memberData) {
    const mobileClean = memberData.mobile.trim();
    const emailClean = memberData.email.trim().toLowerCase();

    if (!/^[0-9]{10}$/.test(mobileClean)) {
      throw new Error("Mobile number must be exactly 10 digits.");
    }

    if (this.isSupabase) {
      // Uniqueness check for email
      const { data: existingEmail } = await this.client
        .from('members')
        .select('id')
        .eq('email', emailClean)
        .neq('id', memberId)
        .maybeSingle();

      if (existingEmail) throw new Error("Email address already registered by another student.");

      const memberRow = {
        name: memberData.name.trim(),
        email: emailClean,
        mobile: mobileClean,
        address: memberData.address ? memberData.address.trim() : null
      };

      // Support setting a new password if filled
      if (memberData.password) {
        memberRow.password = await hashPassword(memberData.password);
      }

      const { data, error } = await this.client
        .from('members')
        .update(memberRow)
        .eq('id', memberId)
        .eq('library_id', libraryId)
        .select()
        .single();

      if (error) throw error;

      return {
        id: data.id,
        libraryId: data.library_id,
        memberIdCustom: data.member_id_custom,
        username: data.username,
        name: data.name,
        email: data.email,
        mobile: data.mobile,
        address: data.address,
        password: data.password,
        qrCodeUrl: data.qr_code_url,
        joinDate: data.join_date,
        createdAt: data.created_at
      };
    } else {
      const members = this._getLocal('smart_lib_members');
      const idx = members.findIndex(m => m.id === memberId && m.libraryId === libraryId);
      if (idx !== -1) {
        const oldMember = members[idx];
        if (members.some(m => m.email === emailClean && m.id !== memberId)) {
          throw new Error("Email address already registered by another student.");
        }

        const updatedMember = {
          ...oldMember,
          name: memberData.name.trim(),
          email: emailClean,
          mobile: mobileClean,
          address: memberData.address ? memberData.address.trim() : null
        };

        if (memberData.password) {
          updatedMember.password = await hashPassword(memberData.password);
        }

        members[idx] = updatedMember;
        this._setLocal('smart_lib_members', members);
        return members[idx];
      }
      throw new Error("Member not found.");
    }
  }

  async deleteMember(libraryId, memberId) {
    if (this.isSupabase) {
      const { error } = await this.client
        .from('members')
        .delete()
        .eq('id', memberId)
        .eq('library_id', libraryId);
      if (error) throw error;
      return true;
    } else {
      let members = this._getLocal('smart_lib_members');
      let issues = this._getLocal('smart_lib_issues');
      let books = this._getLocal('smart_lib_books');

      // Release any books issued by this member
      const activeIssues = issues.filter(i => i.memberId === memberId && i.libraryId === libraryId && i.status === 'issued');
      activeIssues.forEach(i => {
        const book = books.find(b => b.id === i.bookId && b.libraryId === libraryId);
        if (book) {
          book.availableCopies = Math.min(book.totalCopies, book.availableCopies + 1);
        }
      });

      members = members.filter(m => !(m.id === memberId && m.libraryId === libraryId));
      issues = issues.filter(i => !(i.memberId === memberId && i.libraryId === libraryId));

      this._setLocal('smart_lib_books', books);
      this._setLocal('smart_lib_members', members);
      this._setLocal('smart_lib_issues', issues);
      return true;
    }
  }

  // --- ISSUES & RETURNS ---
  async getIssues(libraryId) {
    if (this.isSupabase) {
      const { data, error } = await this.client
        .from('issues')
        .select(`
          *,
          book:books(*),
          member:members(*)
        `)
        .eq('library_id', libraryId)
        .order('issue_date', { ascending: false });

      if (error) throw error;

      return data.map(i => ({
        id: i.id,
        libraryId: i.library_id,
        bookId: i.book_id,
        bookTitle: i.book ? i.book.title : 'Deleted Book',
        bookBarcode: i.book ? i.book.barcode : 'N/A',
        memberId: i.member_id,
        memberIdCustom: i.member ? i.member.member_id_custom : 'N/A',
        memberName: i.member ? i.member.name : 'Deleted Student',
        issueDate: i.issue_date,
        dueDate: i.due_date,
        returnDate: i.return_date,
        fineAmount: parseFloat(i.fine_amount || 0),
        status: i.status
      }));
    } else {
      const issues = this._getLocal('smart_lib_issues');
      const books = this._getLocal('smart_lib_books');
      const members = this._getLocal('smart_lib_members');

      const libIssues = issues.filter(i => i.libraryId === libraryId);
      return libIssues.map(i => {
        const book = books.find(b => b.id === i.bookId);
        const member = members.find(m => m.id === i.memberId);
        return {
          id: i.id,
          libraryId: i.libraryId,
          bookId: i.bookId,
          bookTitle: book ? book.title : 'Deleted Book',
          bookBarcode: book ? book.barcode : 'N/A',
          memberId: i.memberId,
          memberIdCustom: member ? member.memberIdCustom : 'N/A',
          memberName: member ? member.name : 'Deleted Student',
          issueDate: i.issueDate,
          dueDate: i.dueDate,
          returnDate: i.returnDate,
          fineAmount: i.fineAmount || 0,
          status: i.status
        };
      });
    }
  }

  // --- LIBRARY HOLIDAY MANAGEMENT ---
  async getHolidays(libraryId) {
    if (this.isSupabase) {
      const { data, error } = await this.client.from('holidays').select('*').eq('library_id', libraryId).order('holiday_date');
      if (error) throw error;
      return (data || []).map(h => ({ id: h.id, libraryId: h.library_id, date: h.holiday_date, name: h.name }));
    }
    return this._getLocal('smart_lib_holidays').filter(h => h.libraryId === libraryId).sort((a,b) => a.date.localeCompare(b.date));
  }

  async saveHoliday(libraryId, date, name) {
    const cleanName = String(name || '').trim();
    if (!date || !cleanName) throw new Error('Select a date and enter a holiday name.');
    if (this.isSupabase) {
      const { data, error } = await this.client.from('holidays').upsert({ library_id: libraryId, holiday_date: date, name: cleanName }, { onConflict: 'library_id,holiday_date' }).select('*').single();
      if (error) throw error;
      return { id: data.id, libraryId: data.library_id, date: data.holiday_date, name: data.name };
    }
    const list = this._getLocal('smart_lib_holidays');
    const existing = list.find(h => h.libraryId === libraryId && h.date === date);
    if (existing) existing.name = cleanName;
    else list.push({ id: 'holiday_' + Math.random().toString(36).slice(2,10), libraryId, date, name: cleanName });
    this._setLocal('smart_lib_holidays', list);
    return list.find(h => h.libraryId === libraryId && h.date === date);
  }

  async deleteHoliday(libraryId, holidayId) {
    if (this.isSupabase) {
      const { error } = await this.client.from('holidays').delete().eq('library_id', libraryId).eq('id', holidayId);
      if (error) throw error;
      return;
    }
    this._setLocal('smart_lib_holidays', this._getLocal('smart_lib_holidays').filter(h => !(h.libraryId === libraryId && h.id === holidayId)));
  }

  async getAdjustedDueDate(libraryId, dueDate) {
    const holidays = await this.getHolidays(libraryId);
    const holidayDates = new Set(holidays.map(h => h.date));
    const date = new Date(dueDate);
    // Use local calendar dates. Move forward for weekends and configured holidays.
    const toKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    while (date.getDay() === 0 || holidayDates.has(toKey(date))) date.setDate(date.getDate() + 1);
    return date;
  }

  async issueBook(libraryId, barcode, memberIdCustom, durationDays = 14) {
    const barcodeClean = barcode.trim();
    const customIdClean = memberIdCustom.trim();

    if (this.isSupabase) {
      // 1. Fetch Book by barcode or UUID
      let { data: book } = await this.client
        .from('books')
        .select('*')
        .eq('library_id', libraryId)
        .eq('barcode', barcodeClean)
        .maybeSingle();

      if (!book) {
        // Fallback: search by UUID
        const { data: bookUuid } = await this.client
          .from('books')
          .select('*')
          .eq('library_id', libraryId)
          .eq('id', barcodeClean)
          .maybeSingle();
        book = bookUuid;
      }

      if (!book) throw new Error(`No book found with Barcode or ID: ${barcodeClean}`);
      if (book.available_copies <= 0) throw new Error(`"${book.title}" has no available copies left for checkout.`);

      // 2. Fetch Member by custom ID or UUID
      let { data: member } = await this.client
        .from('members')
        .select('*')
        .eq('library_id', libraryId)
        .eq('member_id_custom', customIdClean)
        .maybeSingle();

      if (!member) {
        // Fallback: search by UUID or username
        const { data: memberAlt } = await this.client
          .from('members')
          .select('*')
          .eq('library_id', libraryId)
          .or(`id.eq.${customIdClean},username.eq.${customIdClean.toLowerCase()}`)
          .maybeSingle();
        member = memberAlt;
      }

      if (!member) throw new Error(`No student found with ID: ${customIdClean}`);

      // 3. Check if member already has this book checked out
      const { data: existingIssue } = await this.client
        .from('issues')
        .select('id')
        .eq('library_id', libraryId)
        .eq('book_id', book.id)
        .eq('member_id', member.id)
        .eq('status', 'issued')
        .maybeSingle();

      if (existingIssue) {
        throw new Error(`This student already has an active issue record for "${book.title}".`);
      }

      // Check max borrowing limit
      const { data: activeCount } = await this.client
        .from('issues')
        .select('id')
        .eq('library_id', libraryId)
        .eq('member_id', member.id)
        .eq('status', 'issued');

      const maxLimit = parseInt(localStorage.getItem("smart_lib_setting_max_books") || "5");
      if (activeCount && activeCount.length >= maxLimit) {
        throw new Error(`Checkout limit reached! This student already has ${activeCount.length} active checkouts (Limit: ${maxLimit}).`);
      }

      // 4. Calculate Dates
      const issueDate = new Date();
      const dueDate = new Date(issueDate);
      dueDate.setDate(issueDate.getDate() + parseInt(durationDays));
      const adjustedDueDate = await this.getAdjustedDueDate(libraryId, dueDate);

      // 5. Insert Issue log (Trigger trg_issue_book automatically reduces available copies)
      const issueRow = {
        library_id: libraryId,
        book_id: book.id,
        member_id: member.id,
        due_date: adjustedDueDate.toISOString(),
        status: 'issued'
      };

      const { data: newIssue, error: iErr } = await this.client
        .from('issues')
        .insert(issueRow)
        .select(`
          *,
          book:books(*),
          member:members(*)
        `)
        .single();

      if (iErr) throw iErr;

      return {
        id: newIssue.id,
        libraryId: newIssue.library_id,
        bookId: newIssue.book_id,
        bookTitle: newIssue.book ? newIssue.book.title : 'Book',
        bookBarcode: newIssue.book ? newIssue.book.barcode : '',
        memberId: newIssue.member_id,
        memberIdCustom: newIssue.member ? newIssue.member.member_id_custom : '',
        memberName: newIssue.member ? newIssue.member.name : 'Student',
        issueDate: newIssue.issue_date,
        dueDate: newIssue.due_date,
        returnDate: newIssue.return_date,
        fineAmount: parseFloat(newIssue.fine_amount || 0),
        status: newIssue.status
      };
    } else {
      // LocalStorage Mode
      const books = this._getLocal('smart_lib_books');
      const members = this._getLocal('smart_lib_members');
      const issues = this._getLocal('smart_lib_issues');

      let book = books.find(b => b.libraryId === libraryId && (b.barcode === barcodeClean || b.id === barcodeClean));
      if (!book) throw new Error(`No book found with Barcode or ID: ${barcodeClean}`);
      if (book.availableCopies <= 0) throw new Error(`"${book.title}" has no copies left.`);

      let member = members.find(m => m.libraryId === libraryId && (m.memberIdCustom === customIdClean || m.id === customIdClean || m.username === customIdClean.toLowerCase()));
      if (!member) throw new Error(`No student found with ID: ${customIdClean}`);

      const alreadyHas = issues.some(i => i.libraryId === libraryId && i.bookId === book.id && i.memberId === member.id && i.status === 'issued');
      if (alreadyHas) throw new Error("This student has already checked out this book.");

      const activeList = issues.filter(i => i.libraryId === libraryId && i.memberId === member.id && i.status === 'issued');
      const maxLimit = parseInt(localStorage.getItem("smart_lib_setting_max_books") || "5");
      if (activeList.length >= maxLimit) {
        throw new Error(`Checkout limit reached (${maxLimit} books).`);
      }

      const issueDate = new Date();
      const dueDate = new Date(issueDate);
      dueDate.setDate(issueDate.getDate() + parseInt(durationDays));
      const adjustedDueDate = await this.getAdjustedDueDate(libraryId, dueDate);

      const newIssue = {
        id: 'issue_' + Math.random().toString(36).substr(2, 9),
        libraryId,
        bookId: book.id,
        memberId: member.id,
        issueDate: issueDate.toISOString(),
        dueDate: adjustedDueDate.toISOString(),
        returnDate: null,
        fineAmount: 0,
        status: 'issued'
      };

      book.availableCopies = Math.max(0, book.availableCopies - 1);
      issues.push(newIssue);

      this._setLocal('smart_lib_books', books);
      this._setLocal('smart_lib_issues', issues);

      return {
        id: newIssue.id,
        libraryId,
        bookId: book.id,
        bookTitle: book.title,
        bookBarcode: book.barcode,
        memberId: member.id,
        memberIdCustom: member.memberIdCustom,
        memberName: member.name,
        issueDate: newIssue.issueDate,
        dueDate: newIssue.dueDate,
        returnDate: null,
        fineAmount: 0,
        status: 'issued'
      };
    }
  }

  async returnBook(libraryId, memberIdCustom, barcode) {
    const barcodeClean = barcode.trim();
    const customIdClean = memberIdCustom.trim();

    if (this.isSupabase) {
      // 1. Fetch Book
      let { data: book } = await this.client
        .from('books')
        .select('*')
        .eq('library_id', libraryId)
        .eq('barcode', barcodeClean)
        .maybeSingle();

      if (!book) {
        const { data: bookUuid } = await this.client
          .from('books')
          .select('*')
          .eq('library_id', libraryId)
          .eq('id', barcodeClean)
          .maybeSingle();
        book = bookUuid;
      }
      if (!book) throw new Error(`No book found with Barcode/ID: ${barcodeClean}`);

      // 2. Fetch Member
      let { data: member } = await this.client
        .from('members')
        .select('*')
        .eq('library_id', libraryId)
        .eq('member_id_custom', customIdClean)
        .maybeSingle();

      if (!member) {
        const { data: memberAlt } = await this.client
          .from('members')
          .select('*')
          .eq('library_id', libraryId)
          .or(`id.eq.${customIdClean},username.eq.${customIdClean.toLowerCase()}`)
          .maybeSingle();
        member = memberAlt;
      }
      if (!member) throw new Error(`No student found with ID: ${customIdClean}`);

      // 3. Find active issue
      const { data: activeIssue, error: fetchErr } = await this.client
        .from('issues')
        .select('*')
        .eq('library_id', libraryId)
        .eq('book_id', book.id)
        .eq('member_id', member.id)
        .eq('status', 'issued')
        .maybeSingle();

      if (fetchErr || !activeIssue) {
        throw new Error(`No active checkout found for "${book.title}" issued to "${member.name}".`);
      }

      // 4. Update issue (Trigger trg_return_book increases copies, trg_calculate_fine sets fine_amount)
      const returnDate = new Date().toISOString();
      const { data: updatedIssue, error: updErr } = await this.client
        .from('issues')
        .update({
          return_date: returnDate,
          status: 'returned'
        })
        .eq('id', activeIssue.id)
        .select(`
          *,
          book:books(*),
          member:members(*)
        `)
        .single();

      if (updErr) throw updErr;

      return {
        id: updatedIssue.id,
        libraryId: updatedIssue.library_id,
        bookId: updatedIssue.book_id,
        bookTitle: updatedIssue.book ? updatedIssue.book.title : 'Book',
        bookBarcode: updatedIssue.book ? updatedIssue.book.barcode : '',
        memberId: updatedIssue.member_id,
        memberIdCustom: updatedIssue.member ? updatedIssue.member.member_id_custom : '',
        memberName: updatedIssue.member ? updatedIssue.member.name : 'Student',
        issueDate: updatedIssue.issue_date,
        dueDate: updatedIssue.due_date,
        returnDate: updatedIssue.return_date,
        fineAmount: parseFloat(updatedIssue.fine_amount || 0),
        status: updatedIssue.status
      };
    } else {
      // LocalStorage Mode
      const books = this._getLocal('smart_lib_books');
      const members = this._getLocal('smart_lib_members');
      const issues = this._getLocal('smart_lib_issues');

      const book = books.find(b => b.libraryId === libraryId && (b.barcode === barcodeClean || b.id === barcodeClean));
      if (!book) throw new Error("Book not found.");

      const member = members.find(m => m.libraryId === libraryId && (m.memberIdCustom === customIdClean || m.id === customIdClean || m.username === customIdClean.toLowerCase()));
      if (!member) throw new Error("Student not found.");

      const idx = issues.findIndex(i => i.libraryId === libraryId && i.bookId === book.id && i.memberId === member.id && i.status === 'issued');
      if (idx === -1) throw new Error(`No active checkout found for "${book.title}" borrowed by "${member.name}".`);

      const issue = issues[idx];
      const returnDate = new Date().toISOString();

      // Calculate fine in JS for LocalStorage Mode
      let fineVal = 0;
      const settings = this._getLocal('smart_lib_settings').find(s => s.library_id === libraryId) || { fine_per_day: 1.0 };
      const due = new Date(issue.dueDate);
      const ret = new Date(returnDate);
      if (ret > due) {
        const diffTime = Math.abs(ret - due);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        fineVal = diffDays * settings.fine_per_day;
      }

      issue.returnDate = returnDate;
      issue.status = 'returned';
      issue.fineAmount = fineVal;

      book.availableCopies = Math.min(book.totalCopies, book.availableCopies + 1);

      this._setLocal('smart_lib_books', books);
      this._setLocal('smart_lib_issues', issues);

      return {
        id: issue.id,
        libraryId,
        bookId: book.id,
        bookTitle: book.title,
        bookBarcode: book.barcode,
        memberId: member.id,
        memberIdCustom: member.memberIdCustom,
        memberName: member.name,
        issueDate: issue.issueDate,
        dueDate: issue.dueDate,
        returnDate,
        fineAmount: fineVal,
        status: 'returned'
      };
    }
  }
}

// Instantiate globally
window.smartLibDB = new SupabaseLibraryDB();
