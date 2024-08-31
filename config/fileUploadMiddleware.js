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
function sanitizeFileName(fileName) {
  const name = fileName
    .trim()
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/[^\w.-]/g, ""); // Remove special characters except for word characters, dots, and hyphens
  //make sure name is correctly encooded
  //handle arabic names
  return encodeURI(name);
}

function fileUploadMiddleware(folderName) {
  return (req, res, next) => {
    upload.array("files")(req, res, async (err) => {
      if (err) {
        return res.status(500).send("Error uploading files.");
      }
      const files = req.files;

      if (files && files.length > 0) {
        try {
          // Define the upload directory
          const uploadDir = path.join(__dirname, "../uploads", folderName);
          // Ensure the upload directory exists
          await fs.ensureDir(uploadDir);

          // Process each file
          for (let i = 0; i < files.length; i++) {
            const file = files[i];

            // Define the path for the new file
            const filePath = path.join(
              uploadDir,
              sanitizeFileName(file.originalname)
            );

            // Write the file to the specified path
            await fs.writeFile(filePath, file.buffer);
          }

          // Attach the file paths and descriptions to the request object
          req.filePaths = files.map((file) =>
            path.join(
              "uploads",
              folderName,
              sanitizeFileName(file.originalname)
            )
          );
          req.fileNames = files.map((file) =>
            sanitizeFileName(file.originalname)
          );
          req.descriptions = req.body.descriptions || [];

          next();
        } catch (error) {
          console.error("Error saving files:", error);
          res.status(500).send("Error saving files.");
        }
      } else {
        next();
      }
    });
  };
}

module.exports = fileUploadMiddleware;
