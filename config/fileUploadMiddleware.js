const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");

// Configure multer to store files in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 16000000 }, // Limit file size to 16MB
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif|pdf/;
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb("Error: Images and PDFs only!");
    }
  },
});

function fileUploadMiddleware(folderName) {
  return (req, res, next) => {

    upload.single("file")(req, res, async (err) => {
      if (err) {
        return res.status(500).send("Error uploading file.");
      }
      const file = req.file || (req.files && req.files.file);

      if (file) {
        try {
          // Define the upload directory and file path
          //get the root directory
          const uploadDir = path.join(__dirname, "../uploads", folderName);
          // Ensure the upload directory exists
          await fs.ensureDir(uploadDir);

          // Define the path for the new file
          const filePath = path.join(uploadDir, file.originalname);

          // Write the file to the specified path
          await fs.writeFile(filePath, file.buffer);

          // Attach the file path and description to the request object
          req.filePath = path.join("uploads", folderName, file.originalname);
          req.fileName = file.originalname;
          req.description = req.body.description;

          next();
        } catch (error) {
          console.error("Error saving file:", error);
          res.status(500).send("Error saving file.");
        }
      } else {
        next();
      }
    });
  };
}

module.exports = fileUploadMiddleware;
