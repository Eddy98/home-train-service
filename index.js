const express = require('express');
const axios = require('axios');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const googleTTS = require('google-tts-api');
const Client = require('castv2-client').Client;
const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

const MTA_API_URL_ACE = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace';
const MTA_API_URL_BDFM = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm';
const STATION_ID = 'A17'; // Cathedral Parkway (110 St) parent ID

async function fetchFeed(url) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
    });
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(response.data)
    );
  } catch (error) {
    console.error(`Error fetching feed from ${url}:`, error.message);
    return null;
  }
}

function processFeed(feed, trains, line) {
  if (!feed) return;

  feed.entity.forEach((entity) => {
    if (entity.tripUpdate && entity.tripUpdate.stopTimeUpdate) {
      entity.tripUpdate.stopTimeUpdate.forEach((update) => {
        if (update.stopId && update.stopId.startsWith(STATION_ID)) {
          const time = update.arrival ? update.arrival.time : update.departure ? update.departure.time : null;
          if (time) {
            const arrivalTime = new Date(time * 1000);
            const currentTime = new Date();

            if (arrivalTime > currentTime) {
              trains.push({
                routeId: entity.tripUpdate.trip.routeId,
                direction: update.stopId.includes('N') ? 'UPTOWN' : 'DOWNTOWN',
                arrivalTime: arrivalTime.toLocaleString(),
                arrivalTimeRel: Math.round((arrivalTime - currentTime) / 60000) + ' mins',
                stopId: update.stopId,
                line
              });
            }
          }
        }
      });
    }
  });
}

app.get('/cathedral-parkway', async (req, res) => {
  try {
    const [feedACE, feedBDFM] = await Promise.all([
      fetchFeed(MTA_API_URL_ACE),
      fetchFeed(MTA_API_URL_BDFM)
    ]);

    const trains = [];
    processFeed(feedACE, trains, 'ACE');
    processFeed(feedBDFM, trains, 'BDFM');

    // Sort by arrival time
    trains.sort((a, b) => {
      const timeA = parseInt(a.arrivalTimeRel);
      const timeB = parseInt(b.arrivalTimeRel);
      return timeA - timeB;
    });

    res.json({
      station: 'Cathedral Parkway (110 St)',
      timestamp: new Date().toLocaleString(),
      trains: trains
    });

  } catch (error) {
    console.error('Error fetching MTA data:', error);
    res.status(500).json({ error: 'Failed to fetch MTA data' });
  }
});

function broadcast(text) {
  const ip = process.env.GOOGLE_HOME_IP;
  if (!ip) {
    console.error('GOOGLE_HOME_IP not set');
    return;
  }

  const url = googleTTS.getAudioUrl(text, {
    lang: 'en',
    slow: false,
    host: 'https://translate.google.com',
  });

  const client = new Client();
  console.log(`Connecting to Google Home at ${ip}...`);

  client.connect(ip, function () {
    console.log('Connected, launching media receiver...');
    client.launch(DefaultMediaReceiver, function (err, player) {
      if (err) {
        console.error('Error launching media receiver:', err);
        client.close();
        return;
      }

      const media = {
        contentId: url,
        contentType: 'audio/mp3',
        streamType: 'BUFFERED'
      };

      player.load(media, { autoplay: true }, function (err, status) {
        if (err) {
          console.error('Error loading media:', err);
        } else {
          console.log('Media loaded, playing announcement.');
        }
        client.close();
      });
    });
  });

  client.on('error', function (err) {
    console.error('Error: %s', err.message);
    client.close();
  });
}

app.post('/downtown', async (req, res) => {
  try {
    const [feedACE, feedBDFM] = await Promise.all([
      fetchFeed(MTA_API_URL_ACE),
      fetchFeed(MTA_API_URL_BDFM)
    ]);

    const trains = [];
    processFeed(feedACE, trains, 'ACE');
    processFeed(feedBDFM, trains, 'BDFM');

    // Sort by arrival time
    trains.sort((a, b) => {
      const timeA = parseInt(a.arrivalTimeRel);
      const timeB = parseInt(b.arrivalTimeRel);
      return timeA - timeB;
    });

    if (trains.length === 0) {
      broadcast("No upcoming trains found for Cathedral Parkway.");
      return res.send("No trains found.");
    }

    // Prepare message for the next 2-3 trains
    const nextACETrains = trains.filter(t => t.direction === 'DOWNTOWN' && t.line === 'ACE').slice(0, 2).map(t =>
      `${t.direction} ${t.routeId} train in ${t.arrivalTimeRel}`
    ).join(', ');

    const nextBDFMTrains = trains.filter(t => t.direction === 'DOWNTOWN' && t.line === 'BDFM').slice(0, 2).map(t =>
      `${t.direction} ${t.routeId} train in ${t.arrivalTimeRel}`
    ).join(', ');

    const message = `Next downtown trains: ${nextACETrains} ${nextBDFMTrains.length > 0 ? 'and ' + nextBDFMTrains : ''}`;
    console.log("Broadcasting:", message);
    broadcast(message);

    res.send("Broadcast triggered: " + message);

  } catch (error) {
    console.error('Error in broadcast-trains:', error);
    res.status(500).send('Error triggering broadcast');
  }
});

app.post('/uptown', async (req, res) => {
  try {
    const [feedACE, feedBDFM] = await Promise.all([
      fetchFeed(MTA_API_URL_ACE),
      fetchFeed(MTA_API_URL_BDFM)
    ]);

    const trains = [];
    processFeed(feedACE, trains, 'ACE');
    processFeed(feedBDFM, trains, 'BDFM');

    // Sort by arrival time
    trains.sort((a, b) => {
      const timeA = parseInt(a.arrivalTimeRel);
      const timeB = parseInt(b.arrivalTimeRel);
      return timeA - timeB;
    });

    if (trains.length === 0) {
      broadcast("No upcoming trains found for Cathedral Parkway.");
      return res.send("No trains found.");
    }

    // Prepare message for the next 2-3 trains
    const nextACETrains = trains.filter(t => t.direction === 'UPTOWN' && t.line === 'ACE').slice(0, 2).map(t =>
      `${t.direction} ${t.routeId} train in ${t.arrivalTimeRel}`
    ).join(', ');

    const nextBDFMTrains = trains.filter(t => t.direction === 'UPTOWN' && t.line === 'BDFM').slice(0, 2).map(t =>
      `${t.direction} ${t.routeId} train in ${t.arrivalTimeRel}`
    ).join(', ');

    const message = `Next uptown trains: ${nextACETrains} ${nextBDFMTrains.length > 0 ? 'and ' + nextBDFMTrains : ''}`;
    console.log("Broadcasting:", message);
    broadcast(message);

    res.send("Broadcast triggered: " + message);

  } catch (error) {
    console.error('Error in broadcast-trains:', error);
    res.status(500).send('Error triggering broadcast');
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// --- Sinric Pro Integration ---
const { SinricPro, SinricProConstants } = require('sinricpro');
const sinricPro = new SinricPro(process.env.SINRIC_APP_KEY, [process.env.SINRIC_DEVICE_ID_DOWNTOWN], process.env.SINRIC_APP_SECRET, true);
const callbacks = {
  setPowerState: async (deviceId, data) => {
    console.log('Sinric Pro: Power state for %s is %s', deviceId, data);
    if (deviceId === process.env.SINRIC_DEVICE_ID_DOWNTOWN && data === 'On') {
      console.log('Triggering Downtown Broadcast via Sinric...');

      // Reuse the existing logic by calling the endpoint function logic or refactoring.
      // For simplicity, we'll self-invoke the endpoint locally or duplicate the logic trigger.
      // Best way: separate the logic from the express route.
      triggerDowntownBroadcast();

      // Turn the switch back off after 2 seconds so it acts like a push button
      setTimeout(() => {
        sinricPro.raiseEvent(deviceId, SinricProConstants.eventNames.powerState, 'Off');
        console.log('Sinric Pro: Auto-reset switch to Off');
      }, 2000);
    }
    return true; // confirm success
  }
};

sinricPro.registerCallbacks(callbacks);

// Helper function refactored from the /downtown route
async function triggerDowntownBroadcast() {
  try {
    const [feedACE, feedBDFM] = await Promise.all([
      fetchFeed(MTA_API_URL_ACE),
      fetchFeed(MTA_API_URL_BDFM)
    ]);

    const trains = [];
    processFeed(feedACE, trains, 'ACE');
    processFeed(feedBDFM, trains, 'BDFM');

    trains.sort((a, b) => parseInt(a.arrivalTimeRel) - parseInt(b.arrivalTimeRel));

    if (trains.length === 0) {
      broadcast("No upcoming trains found for Cathedral Parkway.");
      return;
    }

    const nextACETrains = trains.filter(t => t.direction === 'DOWNTOWN' && t.line === 'ACE').slice(0, 2).map(t =>
      `${t.direction} ${t.routeId} train in ${t.arrivalTimeRel}`
    ).join(', ');

    const nextBDFMTrains = trains.filter(t => t.direction === 'DOWNTOWN' && t.line === 'BDFM').slice(0, 2).map(t =>
      `${t.direction} ${t.routeId} train in ${t.arrivalTimeRel}`
    ).join(', ');

    const message = `Next downtown trains: ${nextACETrains} ${nextBDFMTrains.length > 0 ? 'and ' + nextBDFMTrains : ''}`;
    console.log("Broadcasting:", message);
    broadcast(message);

  } catch (error) {
    console.error('Error in triggerDowntownBroadcast:', error);
  }
}
