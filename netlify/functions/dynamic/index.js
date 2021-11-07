const cookie = require("cookie");
const { EleventyServerless } = require("@11ty/eleventy");
const { OAuth, tokens, getCookie } = require("../util/auth.js");

// Explicit dependencies for the bundler from config file and global data.
// The file is generated by the Eleventy Serverless Bundler Plugin.
require("./eleventy-bundler-modules.js");

async function handler(event) {
  let authToken;
  let provider;
  if(event.headers) {
    // console.log( "[serverless fn] cookies", event.headers.cookie );
    let cookies = cookie.parse(event.headers.cookie);
    if(cookies._11ty_oauth_token) {
      authToken = tokens.decode(cookies._11ty_oauth_token);
    }
    if(cookies._11ty_oauth_provider) {
      provider = cookies._11ty_oauth_provider;
    }
  }

  let user;
  let authError;
  try {
    let oauth = new OAuth(provider);
    user = await oauth.getUser(authToken);
  } catch(e) {
    authError = e;
  }

  let elev = new EleventyServerless("dynamic", {
    path: event.path,
    query: event.queryStringParameters,
    functionsDir: "./netlify/functions/",
    config: function(eleventyConfig) {
      if(authToken) {
        eleventyConfig.addGlobalData("authToken", authToken);
      }
      if(user) {
        eleventyConfig.addGlobalData("user", user);
      }

      eleventyConfig.dataFilterSelectors.add("secure");
    }
  });

  try {
    let [ page ] = await elev.getOutput();

    if("logout" in event.queryStringParameters) {
      console.log( "Logging out" );
      return {
        statusCode: 302,
        headers: {
          Location: page.data.secure.unauthenticatedRedirect || "/",
          'Cache-Control': 'no-cache' // Disable caching of this response
        },
        multiValueHeaders: {
          'Set-Cookie': [
            getCookie("_11ty_oauth_token", "", -1),
            getCookie("_11ty_oauth_provider", "", -1),
          ]
        },
        body: ''
      };
    }

    // Secure pages
    if(page.data.secure && authError) {
      console.log("[serverless fn]", event.path, authToken, authError );

      // unauthenticated redirect
      return {
        statusCode: 302,
        headers: {
          Location: page.data.secure.unauthenticatedRedirect || "/",
          'Cache-Control': 'no-cache' // Disable caching of this response
        },
        body: ''
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
      },
      body: page.content,
    };
  } catch (error) {
    // Only console log for matching serverless paths
    // (otherwise you’ll see a bunch of BrowserSync 404s for non-dynamic URLs during --serve)
    if (elev.isServerlessUrl(event.path)) {
      console.log("Serverless Error:", error);
    }

    return {
      statusCode: error.httpStatusCode || 500,
      body: JSON.stringify(
        {
          error: error.message,
        },
        null,
        2
      ),
    };
  }
}

exports.handler = handler;