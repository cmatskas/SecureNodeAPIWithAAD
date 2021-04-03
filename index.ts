
import { ConfidentialClientApplication } from '@azure/msal-node';
import jwt = require('jsonwebtoken');
import jwksClient = require('jwks-rsa');
//import https from 'https';
import { BlobServiceClient } from "@azure/storage-blob";
import {
    AzureCliCredential,
    ChainedTokenCredential,
    ManagedIdentityCredential,
    VisualStudioCodeCredential
} from "@azure/identity";
import express = require('express');
import { CosmosClient, Container, Item } from "@azure/cosmos";


const SERVER_PORT = process.env.PORT || 8000;
const jwtKeyDiscoveryEndpoint = "https://login.microsoftonline.com/common/discovery/keys";
const cosmosEndpoint = "https://msi-auth-test.documents.azure.com";
const storageEndpoint = "https://storageaccountident9234.blob.core.windows.net/";
const credential = new ChainedTokenCredential(
    new AzureCliCredential(),
    new VisualStudioCodeCredential(),
    new ManagedIdentityCredential()
);
let accessToken;

const storageAccount = new BlobServiceClient(
    storageEndpoint,
    credential
);

const cosmosClient = new CosmosClient({ 
    endpoint: cosmosEndpoint, 
    aadCredentials: credential 
});

const validateJwt = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];

        const validationOptions = {
            audience: config.auth.clientId,
            issuer: `${config.auth.authority}/v2.0`
        }

        jwt.verify(token, getSigningKeys, validationOptions, (err, payload) => {
            accessToken = payload;
            if (err) {
                console.log(err);
                return res.sendStatus(403);
            }
            next();
        });
    } else {
        res.sendStatus(401);
    }
};

const getSigningKeys = (header, callback) => {
    var client = jwksClient({
        jwksUri: jwtKeyDiscoveryEndpoint
    });

    client.getSigningKey(header.kid, function (err, key) {
        var signingKey = key.getPublicKey();
        callback(null, signingKey);
    });
};

function confirmRequestHasTheRightScope(scopes:Array<string>): boolean{
    const tokenScopes:Array<string> = accessToken.scp.split(" ");
    scopes.forEach(scope => {
        if(!tokenScopes.includes(scope)){
            return false;
        }
    });
    return true;
}

// Before running the sample, you will need to replace the values in the config, 
// including the clientSecret
const config = {
    auth: {
        clientId: "c7639087-cb59-4011-88ed-5d535bafc525",
        tenantId: "e801a3ad-3690-4aa0-a142-1d77cb360b07",
        authority: "https://login.microsoftonline.com/e801a3ad-3690-4aa0-a142-1d77cb360b07",
    }
};

// Create msal application object
const cca = new ConfidentialClientApplication(config);

// Create Express App and Routes
const app = express();

app.get('/', (req, res)=>{
    var data = {
        "endpoint1": "/liststorageblobs",
        "endpoint2": "/getvolcanodata?volcanoname=<name>",
        "endpoint3": "/getCosmosData"
    };
    res.send(data); 
})

app.get('/liststorageblobs', validateJwt, async (req, res) => {
    const scopes: Array<string> = ["access_as_reader"];
    if(!confirmRequestHasTheRightScope(scopes)){
        res.status(403).send("Missing or invalid scopes");
    };
    var data = await getStorageData();
    res.send(data);
});

app.get('/getCosmosData', async (req, res) => {
    const data = await getCosmosData();
    res.send(data);
});

app.get('/getVolcanoData', async(req, res)=> {
    const data = await getVolcanoDataByName(req.query.volcanoname.toString());
    res.send(data);
});

app.listen(SERVER_PORT, () => console.log(`Secure Node Web API listening on port ${SERVER_PORT}!`))

async function getStorageData(): Promise<Array<string>> {
    const containerClient = storageAccount.getContainerClient("test");
    let data: Array<string> = [];
    try {
        let blobs = containerClient.listBlobsFlat();
        for await (const blob of blobs) {
            data.push(blob.name);
        }
    }
    catch (error) {
        console.error(error);
    }
    return data;
}

async function getVolcanoDataByName(volcanoName: string): Promise<Array<string>> {
    const container = cosmosClient.database('VolcanoList').container('Volcano');
    const results = await container.items
        .query({
            query: "SELECT * FROM Volcano f WHERE  f.VolcanoName = @volcanoName",
            parameters: [{ name: "@volcanoName", value: volcanoName }]
        })
        .fetchAll();
    return results.resources;
}

async function getCosmosData(): Promise<Array<any>> {
    try {
        let data: any[] = [];
        const container = cosmosClient.database('VolcanoList').container('Volcano');
        const results = await container.items.readAll().fetchAll();
        //get the first 10 items
        let index = 0;
        while (index < 10) {
            data.push(results.resources[index]);
            index++;
        };
        return data;
    }
    catch (error) {
        console.error(error);
    }
    return [];
};