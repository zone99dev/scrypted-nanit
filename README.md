
# Nanit Camera
## How to install: 
Install Node and npm -> https://docs.npmjs.com/downloading-and-installing-node-js-and-npm
Install https://www.scrypted.app/ and follow instructions on the website. 
Once you have Scrypted running and can access it...continue
</p>
</p>Open this plugin directory in VS Code
</p>In a terminal cd into this project directory
</p>run `npm install`
</p>run `npm run scrypted-deploy 127.0.0.1` NOTE: you can replace `127.0.0.1` with the ip address of the server you installed scrypted on
</p>* The  `Terminal` area may show an authentication failure and prompt you to log in to the Scrypted Management Console with `npx scrypted login`. You will only need to do this once. You can then relaunch afterwards.
</p>
</p>Launch Scrypted, go to "Devices"
</p>You should see a device named `Nanit Camera Plugin`, click it
</p>Enter your email and password on the right, then click save. 
</p>You'll receive the mfa token enter that in the "Two Factor Code" and click save again
</p>Wait a few seconds then reload the page: Refresh Token, Access Token and Expiration should all have values
</p>Now go back to devices and you should see a new device that is named the same as your Nanit Device. Click it and then click the video and it should be streaming!
</p>
## Troubleshooting
If you aren't seeing the video load, first try clearing the Expiration value in the `Nanit Camera Plugin` and click save. This will force the plugin to get a new token. 
</p>
If you are still having issues then clear the `access_token` and `refresh_token` values and click save. 
</p>
Finally, Login again with your username and password + two factor auth by following instructions in above section
</p>
## Other Notes
</p>It is currently setup as a Battery camera in Scrypted. The only reason this is done is so that Scrypted doesn't pre-buffer. When the camera is not battery Scrypted will stay connected to the stream 24/7, instead of on demand when the rtsp/homekit stream is requested. I suspect if we stay connected to the Nanit stream 24/7 they would take notice eventually. 
</p>
</p>If you want to disable this. Remove the ScryptedInterface.Battery from line main.ts.
`
const interfaces = [
                ScryptedInterface.Camera,
                ScryptedInterface.VideoCamera,
                ScryptedInterface.MotionSensor,
                ScryptedInterface.Battery //REMOVE THIS
            ];
 `
</p>
## Importing into Home Assistant
</p>Under the camera, make sure the rebroadcast plugin is enabled. 
</p>In the Camera settings go to the Stream and there should be a "RTSP Rebroadcast URL" box. Copy that value
</p>In HomeAssistant add a camera entity -> https://www.home-assistant.io/integrations/generic/ 
</p>  The copied value is your "stream source"
