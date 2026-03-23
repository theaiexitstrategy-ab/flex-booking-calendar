# Flex Booking Calendar — Backend

## New Environment Variables (add to Vercel)

| Variable | Value |
|---|---|
| AIRTABLE_API_KEY | Airtable Personal Access Token |
| AIRTABLE_BASE_ID | app0MAjRtdbZ4na2h |
| TWILIO_ACCOUNT_SID | From Twilio Console dashboard |
| TWILIO_AUTH_TOKEN | From Twilio Console dashboard |
| TWILIO_FROM_NUMBER | SMS-enabled Twilio phone number |

## API Endpoints

- **GET** `/api/availability?month=3&year=2026&session_type=athlete` — get available slots for a given month
- **POST** `/api/bookings` — create booking, update Airtable, send confirmation SMS
- **GET** `/api/booking?id=recXXXXXX` — get single booking
- **PATCH** `/api/booking?id=recXXXXXX` — update booking (reschedule/cancel)
- **POST** `/api/sms` — send SMS via Twilio

## How Availability Works

Real bookings from Airtable `Bookings — Master` are counted against each slot. Slots at max capacity show as FULL. Blocked dates from `Availability — Master` show as unavailable on the calendar.

The frontend loads availability from `/api/availability` on page load, on month change, and on session type switch. If the API is unreachable, it falls back gracefully to the hardcoded schedule so the calendar never shows a broken state.

## Airtable Tables to Create Manually

### Table 1: Availability — Master

| Field | Type | Notes |
|---|---|---|
| Day of Week | Single line text | e.g. "Monday" |
| Day Number | Number | 0=Sun, 1=Mon, etc. |
| Start Time | Single line text | e.g. "9:00 AM" |
| End Time | Single line text | e.g. "6:00 PM" |
| Is Available | Checkbox | |
| Blocked Date | Date | For specific days off |
| Block Reason | Single line text | "Holiday", "Travel", etc. |
| Created At | Date | |

### Table 2: SMS Log

| Field | Type | Notes |
|---|---|---|
| Recipient Name | Single line text | |
| Recipient Phone | Phone number | |
| Message | Long text | |
| Sent At | Date | |
| Sent By | Single select | "System", "Coach Kenny", "Aaron" |
| Status | Single select | "Sent", "Delivered", "Failed" |
| Twilio SID | Single line text | |
| Booking ID | Single line text | |
| Created At | Date | |
