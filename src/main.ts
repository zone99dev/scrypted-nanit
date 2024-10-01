import { Battery, BinarySensor, Camera, Device, DeviceCreator, DeviceCreatorSettings, DeviceDiscovery, DeviceProvider, FFmpegInput, Intercom, MediaObject, MediaStreamOptions, MotionSensor, PictureOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { StorageSettings } from "@scrypted/sdk/storage-settings"
import path from 'path';
import axios, { AxiosRequestConfig } from 'axios'
import { fail } from 'assert';

const { log, deviceManager, mediaManager } = sdk;


class NanitCameraDevice extends ScryptedDeviceBase implements Intercom, Camera, VideoCamera, MotionSensor, BinarySensor, Battery {
    constructor(public plugin: NanitCameraPlugin, nativeId: string) {
        super(nativeId);
    }

    async takePicture(options?: PictureOptions): Promise<MediaObject> {
        this.console.log("trying to take a photo")
        let ffmpegInputVal: FFmpegInput;
        ffmpegInputVal = this.ffmpegInput(options);
        ffmpegInputVal.videoDecoderArguments = ['-vframes', '1', '-q:v', '2']
        return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInputVal)), ScryptedMimeTypes.FFmpegInput);
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        // can optionally provide the different resolutions of images that are available.
        // used by homekit, if available.
        return;
    }

    async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        this.console.log("Attempting to confirm access token to retrieve video stream")
        await this.plugin.tryLogin();
        this.console.log("Login Succeeded. Returning video stream")
        let ffmpegInputVal: FFmpegInput;

        if (!this.nativeId) {
            throw new Error("missing nativeId");
        }
        if (!this.plugin.access_token) {
            throw new Error("missing access token");
        }
        this.batteryLevel = 100;
        ffmpegInputVal = this.ffmpegInput(options);
        

        return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInputVal)), ScryptedMimeTypes.FFmpegInput);
    }

    ffmpegInput(options?: MediaStreamOptions): FFmpegInput {
        this.console.log("Creating stream with camera:" + this.nativeId)
        const file = "rtmps://media-secured.nanit.com/nanit/"+ this.nativeId! +"."+this.plugin.access_token;

        return {
            url: undefined,
            inputArguments: [
                '-i', file,
            ]
        };
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        return [{
            id: this.nativeId + "-stream",
            allowBatteryPrebuffer: false,
            video: {
                codec: 'h264',
            }
        }];
    }


    async startIntercom(media: MediaObject): Promise<void> {
        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());
        // something wants to start playback on the camera speaker.
        // use their ffmpeg input arguments to spawn ffmpeg to do playback.
        // some implementations read the data from an ffmpeg pipe output and POST to a url (like unifi/amcrest).
        throw new Error('not implemented');
    }

    async stopIntercom(): Promise<void> {
    }

    // most cameras have have motion and doorbell press events, but dont notify when the event ends.
    // so set a timeout ourselves to reset the state.
    triggerBinaryState() {
        this.binaryState = true;
        setTimeout(() => this.binaryState = false, 10000);
    }

    // most cameras have have motion and doorbell press events, but dont notify when the event ends.
    // so set a timeout ourselves to reset the state.
    triggerMotion() {
        this.motionDetected = true;
        setTimeout(() => this.motionDetected = false, 10000);
    }
}

class NanitCameraPlugin extends ScryptedDeviceBase implements DeviceProvider, Settings, DeviceCreator {
    devices = new Map<string, NanitCameraDevice>();
    access_token = '';
    mfa_token = '';
    failedCount = 0;


    settingsStorage = new StorageSettings(this, {
        email: {
            title: 'Email',
            onPut: async () => this.clearAndTrySyncDevices(),
        },
        password: {
            title: 'Password',
            type: 'password',
            onPut: async () => this.clearAndTrySyncDevices(),
        },
        twoFactorCode: {
            title: 'Two Factor Code',
            description: 'Optional: If 2 factor is enabled on your account, enter the code sent to your email or phone number.',
            type: "string",
            onPut: async (oldValue, newValue) => {
                await this.tryLogin(newValue);
                await this.syncDevices(0);
            },
            noStore: true,
        }, 
        refresh_token: {
            title: 'refresh_token'
        },
        access_token: {
            title: 'access_token'
        },
        expiration: {
            title: 'expiration',
            onPut: async () => this.syncDevices(0),
        },
    });

    constructor() {
        super();
        this.console.log("calling syncDevices from constructor")
        this.syncDevices(0);
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'name',
                title: 'Name',
            }, 
            {
                key: 'baby_uid',
                title: 'baby_uid',
            }
        ];
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const nativeId = settings.baby_uid?.toString();
        
        await deviceManager.onDeviceDiscovered({
            nativeId,
            type: ScryptedDeviceType.Camera,
            interfaces: [
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Camera,
            ],
            name: settings.name?.toString(),
        });
        return nativeId;
    }

    onDeviceEvent(eventInterface: string, eventData: any): Promise<void> {
        this.console.log("Device Event occured " + eventInterface)
        return Promise.resolve();
    }

    clearAndTrySyncDevices() {
        // add code to clear any r
        this.console.log("clearAndTrySyncDevices called");
        this.access_token = '';
        this.settingsStorage.putSetting("access_token", '');
        this.syncDevices(0);
    }

    async clearAndLogin() {
        this.console.log("clearAndLogin called called");
        this.access_token = '';
        this.settingsStorage.putSetting("access_token", '');
        return this.tryLogin('');
    }

    async tryLogin(twoFactorCode?: string) {
        this.console.log("trying login...");

        const settings: Setting[] = await this.getSettings();
        const email: String = this.settingsStorage.getItem("email");
        const password: String = this.settingsStorage.getItem("password");
        let saved_access_token = this.settingsStorage.getItem("access_token")
        const expiration = this.settingsStorage.getItem("expiration")
        const refresh_token = this.settingsStorage.getItem("refresh_token")

        if (saved_access_token) {
            this.access_token = saved_access_token;
        }

        if (!email || !password) {
            this.console.log("Email and password required");
            throw new Error("Email and password required");
            return;
        }
        if ( this.access_token && expiration > Date.now()) {
            //we already have a good access token that isn't expired
            this.console.log("Access Token Already Exists and is not expired. Going to call babies api to ensure we are logged in")
            //verify we are actually logged in
            const authenticatedConfig:AxiosRequestConfig = {
                headers:{
                  "nanit-api-version": 1,
                  "Authorization": "Bearer " +  this.access_token
                },
                validateStatus: function (status) {
                    return (status >= 200 && status < 300) || status == 401; // default
                }
            };
    
        
    
            return axios.get("https://api.nanit.com/babies", authenticatedConfig).then((response) => {
                //we are authenticated nothing to do
        
                if (response.status == 401 &&  this.failedCount < 2) {
                    this.console.log('failed to auth but received 401 so will clear tokens and try again')
                    this.failedCount++;
                    return this.clearAndLogin()
                } else if (this.failedCount > 2){
                    return Promise.reject("Exceeded fail count");
                } else {
                    this.failedCount = 0;
                    this.console.log("Confirmed we are authenticated. Stream should Work")
                }
            }).catch((error) => {
                if (error.response.status == 401 &&  this.failedCount < 2) {
                    this.console.log('OLD| SHOULD NOT EXECUTE | failed to auth but received 401 so will clear tokens and try again')
                    this.failedCount++;
                    return this.clearAndLogin()
                } else {
                    throw new Error("Failed to authenticate")
                }
            })
        }
        
        const config = {
            headers:{
              "nanit-api-version": 1
            }
          };
        if (refresh_token) {
            this.console.log("we have a refresh token...calling the token refresh api");
            return axios.post("https://api.nanit.com/tokens/refresh",{"refresh_token":refresh_token}, config).then((response) => {
                this.console.log("Received new access token");
                this.failedCount = 0;
                this.access_token = response.data.access_token;
                this.settingsStorage.putSetting("access_token", response.data.access_token)
                this.settingsStorage.putSetting("refresh_token", response.data.refresh_token)
                this.settingsStorage.putSetting("expiration",  Date.now() + (1000 * 60 * 60 * 4))
            }).catch((error) => {
                this.console.log("Failed to talk to nanit"+ error);
            });
        }

        if (!twoFactorCode || ! this.mfa_token) {
            this.console.log("calling the login api without mfa. will need to call again to get access/refresh token");
            return axios.post("https://api.nanit.com/login",{"email":email,"password":password},config).then((response) => {
       
                this.console.log("Login successful. setting mfa token and will recall login")
                this.mfa_token = response.data.mfa_token;
            }).catch((error) => {
                this.mfa_token = error.response.data.mfa_token;
                if ( this.mfa_token) {
                    this.console.log("response from email/pass login:" + error.response)
                } else {
                    this.console.log("Failed to talk to nanit"+ error);
                }
                
            });
        }

        this.console.log("calling the login api with mfa to get access and refresh token");
    
        return axios.post("https://api.nanit.com/login",{"email":email,"password":password, "mfa_token":  this.mfa_token, "mfa_code": twoFactorCode},config).then((response) => {
            this.failedCount = 0;
                this.console.log("response from email/pass/mfa login. Received new access token and refresh token")
                this.access_token = response.data.access_token;
                this.settingsStorage.putSetting("access_token", response.data.access_token)
                this.settingsStorage.putSetting("refresh_token", response.data.refresh_token)
                this.settingsStorage.putSetting("expiration",  Date.now() + (1000 * 60 * 60 * 4))
           }).catch((error) => {
                this.console.log("Failed to talk to nanit"+ error);
                throw new Error(error.message)
           });
        
    }

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value);
    }

    async syncDevices(duration: number) {
        this.console.log("Sync Devices")
        await this.tryLogin();
        const config = {
            headers:{
              "nanit-api-version": 1,
              "Authorization": "Bearer " +  this.access_token
            }
        };


        const babies: any[] = (await axios.get("https://api.nanit.com/babies", config)).data.babies;
        const devices: Device[] = [];
        for (const camera of babies) {
            const nativeId = camera.uid;
            const interfaces = [
                ScryptedInterface.Camera,
                ScryptedInterface.VideoCamera,
                ScryptedInterface.MotionSensor,
                ScryptedInterface.Battery
            ];

            const device: Device = {
                info: {
                    model: 'Nanit Cam',
                    manufacturer: 'Nanit',
                },
                nativeId,
                name: camera.name,
    
                type: ScryptedDeviceType.Camera,
                interfaces,
            };
            devices.push(device);
        }

        await deviceManager.onDevicesChanged({
            devices,
        });
        this.console.log('discovered devices');
    }

    async getDevice(nativeId: string) {
        this.console.log("get device with id " + nativeId)
        if (!this.devices.has(nativeId)) {
            const camera = new NanitCameraDevice(this, nativeId);
            
            this.devices.set(nativeId, camera);
        }
        return this.devices.get(nativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        
    }
}

export default NanitCameraPlugin;
