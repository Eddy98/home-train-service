const express = require('express');
const axios = require('axios');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
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

function processFeed(feed, trains) {
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
                direction: update.stopId.includes('N') ? 'Northbound' : 'Southbound',
                arrivalTime: arrivalTime.toLocaleString(),
                arrivalTimeRel: Math.round((arrivalTime - currentTime) / 60000) + ' mins',
                stopId: update.stopId
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
    processFeed(feedACE, trains);
    processFeed(feedBDFM, trains);

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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
