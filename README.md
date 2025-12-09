## FLAM Collaborative Canvas

1] A real-time collaborative whiteboard built with Vanilla JavaScript, Express.js, and WebSockets, where multiple users can draw simultaneously on a shared canvas.

2] Each user gets a unique color and can see others’ cursors live — optimized for both desktop and mobile browsers.



## Setup Instructions

1] Clone the repository:

        git clone https://github.com/Raj-dina005/Real-Time-Collaborative-Drawing-Canvas
        cd flam-canvas.

2] Install dependencies:

         npm install

3] Start the application

   npm start
   he server will start at:
         http://localhost:3000



## Deployment (Render)

You can deploy this project for free using Render:

1] Push this code to GitHub

2] On Render, create a New Web Service

3] Use these settings:

       Build Command: npm install.

       Start Command: npm start.

4] After deployment, you’ll get a public link like:
   
          https://real-time-collaborative-drawing-canvas-pi9y.onrender.com


## How to Test with Multiple Users

1] Open the app in two or more browsers or devices.

2] Enter a name in the input box (optional).

3] Start drawing — strokes will appear instantly across all connected clients.

4] Try using Undo and Clear — these actions sync globally in real time.

5] You can also test touch drawing on mobile devices (supported).




## Core Features

1] Real-time multi-user drawing sync.

2] Unique color assigned per user.

3] Live cursor tracking with name labels.

4] Undo & clear tools.

5] Mobile-friendly UI (touch drawing).

6] Confetti reactions. 

7] Performance metrics (FPS counter + RTT latency).

8] Auto-scaling responsive design.




## Known Limitations / Bugs

1] Free Render servers may sleep after 15 minutes of inactivity (first load might take a few seconds).

2] Occasional slight delay when multiple users draw simultaneously due to WebSocket queueing.

3] No authentication — user identity is based only on chosen display name.

4] Mobile performance may vary on older browsers.


## Time Spent on Project


Task	                                    Duration
Research & Setup	                        2 hours
Canvas drawing logic	                    2 hours
Real-time WebSocket sync	                2 hours
UI design and mobile optimization	        2 hours
Testing, debugging & docs	                1 hour
Total	                                   ~9 hours




## Developer

Raj R

Enthusiastic frontend developer passionate about real-time collaboration tools and UI/UX design.

Made with as part of the FLAM Technical Assignment (Frontend) 2025.



## APP DEMO VIDEO

      https://drive.google.com/file/d/1eNCnto0EbZ4hPj4kfPIxoppmeBxXHp-G/view?t=11
   

