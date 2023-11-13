const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

admin.initializeApp();

exports.trimAudio = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const { startTime, endTime, audioUrl } = req.body;
    if (startTime == null || endTime == null || !audioUrl) {
        return res.status(400).send('Invalid input parameters');
    }

    const formattedStartTime = convertMsToTimeFormat(startTime);
    const durationTime = endTime - startTime;

    try {
        const tempFilePath = path.join(os.tmpdir(), 'sourceAudio.mp3');
        await downloadFile(audioUrl, tempFilePath);

        // Generate the output file name based on original name and time inputs
        const outputFileName = generateOutputFileName(audioUrl, startTime, endTime);
        const outputFilePath = path.join(os.tmpdir(), outputFileName);

        await trimAudioFile(tempFilePath, formattedStartTime, durationTime, outputFilePath);

        const publicUrl = await uploadToFirebaseStorage(outputFilePath, outputFileName);
        return res.status(200).send({ url: publicUrl });
    } catch (error) {
        console.error('Error processing audio file:', error);
        return res.status(500).send('Error processing audio file');
    }
});

// Converts milliseconds to 'hh:mm:ss.milliseconds' format for ffmpeg
function convertMsToTimeFormat(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const ms = milliseconds % 1000;
    const date = new Date(0);
    date.setSeconds(seconds);
    const timeString = date.toISOString().substr(11, 8);
    return `${timeString}.${ms}`;
}

// Download file using Axios
async function downloadFile(fileUrl, outputPath) {
    const response = await axios({
        method: 'get',
        url: fileUrl,
        responseType: 'stream'
    });
    response.data.pipe(fs.createWriteStream(outputPath));
    return new Promise((resolve, reject) => {
        response.data.on('end', resolve);
        response.data.on('error', reject);
    });
}

// Trim audio file using FFmpeg
async function trimAudioFile(inputPath, startTime, duration, outputPath) {
    console.info('Starting audio file trimming process');

    return new Promise((resolve, reject) => {
        console.info('Setting up FFmpeg with input:', inputPath);

        ffmpeg(inputPath)
            .setFfmpegPath(ffmpegStatic)
            .audioCodec('libmp3lame')
            .setStartTime(startTime)
            .setDuration(duration / 1000)
            .output(outputPath)
            .on('start', (commandLine) => {
                console.info('Spawned FFmpeg with command:', commandLine);
            })
            .on('end', () => {
                console.info('Audio file trimming completed:', outputPath);
                resolve();
            })
            .on('error', (err) => {
                console.error('Error during FFmpeg processing:', err);
                reject(err);
            })
            .on('progress', (progress) => {
                console.info('Processing progress:', progress);
            })
            .run();
    });
}


/**
 * Generates a new filename based on the original audio file URL and the provided start and end times.
 * 
 * @param {string} audioUrl - The URL of the original audio file.
 * @param {number} startTime - The start time in milliseconds.
 * @param {number} endTime - The end time in milliseconds.
 * @return {string} The generated filename for the trimmed audio file.
 */
function generateOutputFileName(audioUrl, startTime, endTime) {
    // Extracts just the filename from the URL, discarding the path.
    const originalFileName = path.basename(audioUrl);

    // Extracts the file extension from the filename.
    const fileExtension = path.extname(originalFileName);

    // Removes the file extension from the filename to get the base name.
    const baseName = originalFileName.replace(fileExtension, '');

    // Constructs the new filename using the base name and appending the start and end times,
    // followed by the original file extension.
    return `${baseName}-trimmed-${startTime}-${endTime}${fileExtension}`;
}


// Upload trimmed audio to Firebase Storage and return public URL
async function uploadToFirebaseStorage(filePath, fileName) {
    const bucket = admin.storage().bucket();
    const uploadResponse = await bucket.upload(filePath, {
        destination: `trimmedAudios/${fileName}`,
    });
    const file = bucket.file(uploadResponse[0].name);
    await file.makePublic();
    return file.publicUrl();
}

// firebase deploy --only functions
