const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

// Initialize Firebase Admin SDK
admin.initializeApp();

// Cloud Function: HTTP-triggered to process audio file
exports.trimAudio = functions.https.onRequest(async (req, res) => {
    // Ensure the request is a POST request
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // Extract start time, end time, and audio URL from the request body
    const { startTime, endTime, audioUrl } = req.body;
    if (startTime == null || endTime == null || !audioUrl) {
        return res.status(400).send('Invalid input parameters');
    }

    // Convert milliseconds to 'hh:mm:ss.milliseconds' format for ffmpeg
    const convertMsToTimeFormat = (milliseconds) => {
        const seconds = Math.floor(milliseconds / 1000);
        const ms = milliseconds % 1000;
        const date = new Date(0);
        date.setSeconds(seconds);
        const timeString = date.toISOString().substr(11, 8);
        return `${timeString}.${ms}`;
    };

    // Format the start time and calculate duration
    const formattedStartTime = convertMsToTimeFormat(startTime);
    const durationTime = endTime - startTime;

    try {
        // Download the audio file to a temporary path
        const tempFilePath = path.join(os.tmpdir(), 'sourceAudio.mp3');
        const response = await axios({
            method: 'get',
            url: audioUrl,
            responseType: 'stream'
        });
        response.data.pipe(fs.createWriteStream(tempFilePath));
        await new Promise((resolve, reject) => {
            response.data.on('end', resolve);
            response.data.on('error', reject);
        });

        // Process (trim) the audio file using ffmpeg
        const outputFilePath = path.join(os.tmpdir(), 'trimmedAudio.mp3');
        await new Promise((resolve, reject) => {
            ffmpeg(tempFilePath)
                .setFfmpegPath(ffmpegStatic)
                .audioCodec('libmp3lame')
                .setStartTime(formattedStartTime)
                .setDuration(durationTime / 1000) // Convert duration from ms to seconds
                .output(outputFilePath)
                .on('end', resolve)
                .on('error', reject)
                .run();
        });

        // Upload the trimmed file to Firebase Storage
        const bucket = admin.storage().bucket();
        const uploadResponse = await bucket.upload(outputFilePath, {
            destination: `trimmedAudios/trimmedAudio.mp3`,
        });

        // Generate a public URL for the uploaded file
        const file = bucket.file(uploadResponse[0].name);
        await file.makePublic();
        const publicUrl = file.publicUrl();

        // Return the public URL of the uploaded file
        return res.status(200).send({ url: publicUrl });
    } catch (error) {
        console.error('Error processing audio file:', error);
        return res.status(500).send('Error processing audio file');
    }
});
