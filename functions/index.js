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
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .setFfmpegPath(ffmpegStatic)
            .audioCodec('libmp3lame')
            .setStartTime(startTime)
            .setDuration(duration / 1000)
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
}

// Generate output file name based on original URL and time inputs
function generateOutputFileName(audioUrl, startTime, endTime) {
    const urlParts = audioUrl.split('/');
    const originalFileName = urlParts[urlParts.length - 1].split('.')[0];
    return `${originalFileName}-trimmed-${startTime}-${endTime}.mp3`;
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
