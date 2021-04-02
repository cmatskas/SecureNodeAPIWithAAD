
import { ConfidentialClientApplication } from '@azure/msal-node';
import jwt = require('jsonwebtoken');
import jwksClient = require('jwks-rsa');
//import https from 'https';
import { BlobServiceClient } from "@azure/storage-blob";
import { AzureCliCredential, 
         ChainedTokenCredential, 
         ManagedIdentityCredential, 
         VisualStudioCodeCredential } from "@azure/identity";
import express = require('express');
import {CosmosClient, Container, Item} from "@azure/cosmos";


const SERVER_PORT = process.env.PORT || 8000;
const endpoint = "https://msi-auth-test.documents.azure.com";
const credential = new ChainedTokenCredential(
        new AzureCliCredential(),
        new VisualStudioCodeCredential(), 
        new ManagedIdentityCredential()
    );
const storageAccount = new BlobServiceClient(
    "https://storageaccountident9234.blob.core.windows.net/",
    credential);

const cosmosCredential = new AzureCliCredential();
const cosmosClient = new CosmosClient({endpoint, aadCredentials:cosmosCredential});

const validateJwt = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];

        const validationOptions = {
            audience: config.auth.clientId,
            issuer: config.auth.authority + "/v2.0"
        }

        jwt.verify(token, getSigningKeys, validationOptions, (err, payload) => {
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
        jwksUri: 'https://login.microsoftonline.com/common/discovery/keys'
    });

    client.getSigningKey(header.kid, function (err, key) {
        //var signingKey = key.publicKey || key.rsaPublicKey;
        var signingKey = key.getPublicKey();
        callback(null, signingKey);
    });
}

// Before running the sample, you will need to replace the values in the config, 
// including the clientSecret
const config = {
    auth: {
        clientId: "bb97c35c-7bd3-43b0-9a2f-3eb3fd85caee",
        authority: "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47",
        clientSecret: "",
    }
};

// Create msal application object
const cca = new ConfidentialClientApplication(config);

// Create Express App and Routes
const app = express();

app.get('/liststorageblobs', validateJwt, async (req, res) => {
    // validate the scope!
    var data = await getStorageData();
    res.send(data);
});

app.get('/getCosmosData', async (req, res) => {
    const data = await getCosmosData();
    res.send(data);
});

app.listen(SERVER_PORT, () => console.log(`Msal Node Web API listening on port ${SERVER_PORT}!`))

async function getStorageData(){
    const containerClient = storageAccount.getContainerClient("test");
    let data: Array<string> = [];
    try {
        let blobs = containerClient.listBlobsFlat();
        for await (const blob of blobs) {
            data.push(blob.name);
        }
    }
    catch(error){
        console.error(error);
    }

    return data;
}

async function getCosmosData(){
    try{
        const {database} = await cosmosClient.databases.createIfNotExists({id:"Volcano"});
        const {container} = await database.containers.createIfNotExists({id:"VolcanoList"});    
        return await container.item("1").read();
    }
    catch(error){
        console.error(error);
    }
    return {};
}
