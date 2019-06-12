'use strict'

// Require AWS and create a DynamoDB document client
// const AWS = require('aws-sdk')
// const dynamoClient = new AWS.DynamoDB.DocumentClient()

// Retrieve our table name from the USERS_TABLE environment variable
// const USERS_TABLE = process.env.USERS_TABLE

class UserRepository {

    /**
     * Returns the user with the specified id.
     * @param id                The ID of the user to return
     * @returns {Promise<any>}  The user with the specified ID.
     */
    findById(id) {

        // Slow wasteful code
        let value = 0
        for (let i=0; i<10000000; i++) {
            value += (i * 12345) / 123
        }

        return new Promise((resolve, reject) => {
            resolve({
                id: id,
                name: 'Username',
                version: '1'
            })
        })
    }

    doSomethingElse(id) {

        // Slow wasteful code
        let value = 0
        for (let i=0; i<10000000; i++) {
            value += (i * 12345) / 123
        }

        return new Promise((resolve, reject) => {
            resolve({
                id: id,
                name: 'Username',
                version: '1'
            })
        })
    }
}

module.exports = new UserRepository()