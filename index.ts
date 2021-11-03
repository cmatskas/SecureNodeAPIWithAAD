
import jwt from 'jsonwebtoken';
import msalNode from '@azure/msal-node';
import jwksRsa from 'jwks-rsa';
import https from 'https';
import storageBlob from "@azure/storage-blob";
import { SecretClient} from "@azure/keyvault-secrets";
import {
    AzureCliCredential,
    ChainedTokenCredential,
    ManagedIdentityCredential
} from "@azure/identity";
import express from 'express';
import { CosmosClient} from "@azure/cosmos";


const SERVER_PORT = process.env.PORT || 8000;
const jwtKeyDiscoveryEndpoint = "https://login.microsoftonline.com/common/discovery/keys";
const cosmosEndpoint = "https://cm-cosmos-demo.documents.azure.com";
const storageEndpoint = "https://cmdemo20210224.blob.core.windows.net/";
const keyVaultEndpoint = "https://cm-identity-kv.vault.azure.net/";
const credential = new ChainedTokenCredential(
    new ManagedIdentityCredential(),
    new AzureCliCredential()
);

let accessToken;
const clientSecret = await getClientSecretFromKV();

const storageAccount = new storageBlob.BlobServiceClient(
    storageEndpoint,
    credential
);

const cosmosClient = new CosmosClient ({ 
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
    var client = new jwksRsa.JwksClient({
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

const config = {
    auth: {
        clientId: "c7639087-cb59-4011-88ed-5d535bafc525",
        tenantId: "e801a3ad-3690-4aa0-a142-1d77cb360b07",
        authority: "https://login.microsoftonline.com/e801a3ad-3690-4aa0-a142-1d77cb360b07",
        clientSecret: clientSecret.value
    }
};

// Create msal application object
const cca = new msalNode.ConfidentialClientApplication(config);

// Create Express App and Routes
const app = express();

app.get('/', (req, res)=>{
    var data = {
        "endpoint1": "/blobstorage",
        "endpoint2": "/volcano?volcanoname=<name>",
        "endpoint3": "/cosmos",
        "endpoint4": "/graph"
    };
    res.send(data); 
})

app.get('/blobstorage', validateJwt, async (req, res) => {
    const scopes: Array<string> = ["access_as_reader"];
    if(!confirmRequestHasTheRightScope(scopes)){
        res.status(403).send("Missing or invalid scopes");
    };
    var data = await getStorageData();
    res.send(data);
});

app.get('/cosmos', async (req, res) => {
    const data = await getCosmosData();
    res.send(data);
});

app.get('/volcano',validateJwt, async(req, res)=> {
    const data = await getVolcanoDataByName(req.query.volcanoname.toString());
    res.send(data);
});

app.get("/graph", validateJwt, (req, res)=>{
    const authHeader = req.headers.authorization;

    const oboRequest = {
        oboAssertion: authHeader.split(' ')[1],
        scopes: ["user.read"],
    }

    cca.acquireTokenOnBehalfOf(oboRequest).then((response) => {
        getGraphData(response.accessToken, (graphResponse)=> {
            res.status(200).send(graphResponse);
        });
    }).catch((error) => {
        res.status(500).send(error);
    });
});

app.listen(SERVER_PORT, () => console.log(`Secure Node Web API listening on port ${SERVER_PORT}!`))

const getGraphData= (accessToken:string, callback:any) => {
    const options = {
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + accessToken,
        }
    };

    const req = https.request("https://graph.microsoft.com/v1.0/me", options, (res) => {
        res.setEncoding('utf8');
        res.on('data', (responseData) => {
            callback(responseData);
        });
    });
    req.on('error', (err) => {
        console.error(err);
    });
    req.end();
}

async function getStorageData(): Promise<Array<string>> {
    const containerClient = storageAccount.getContainerClient("sample-data");
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

async function getClientSecretFromKV() {
    const client = new SecretClient(keyVaultEndpoint, credential);
    return await client.getSecret("clientSecret");
};
