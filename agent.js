'use strict'

const uuid = require('uuid/v4')
const AWS = require('aws-sdk')

const SERVERLESS_APM_TRACE = []
const SERVERLESS_APM_APPLICATION_NAME = process.env.SERVERLESS_APM_APPLICATION_NAME
const SERVERLESS_APM_TIER_NAME = process.env.SERVERLESS_APM_TIER_NAME
const SERVERLESS_APM_COMPONENT_NAME = process.env.SERVERLESS_APM_COMPONENT_NAME
const SERVERLESS_APM_SQS_REGION = process.env.SERVERLESS_APM_SQS_REGION
const SERVERLESS_APM_SQS_URL = process.env.SERVERLESS_APM_SQS_URL
const SERVERLESS_APM_ACCOUNT_ID = process.env.SERVERLESS_APM_ACCOUNT_ID

const sqs = new AWS.SQS({region: SERVERLESS_APM_SQS_REGION});

const publishToSqs = transaction => {
    return new Promise((resolve, reject) => {
        const params = {
            MessageBody: JSON.stringify(transaction),
            QueueUrl: SERVERLESS_APM_SQS_URL
        }

        // Execute a get() to retrieve the results of the query
        sqs.sendMessage(params).promise()
            .then(data => {
                console.log(`Publish to SQS successful: ${JSON.stringify(data)}`)
                resolve(data)
            })
            .catch(err => {
                console.log(`Publish to SQS failed: ${JSON.stringify(err)}`)
                reject(err)
            })
    })
}

const isPromise = obj => {
    return obj.__proto__.toString() === "[object Promise]"
}

const completeTrace = async () => {
    // Find the start transaction trace element
    const startTransactionElement = SERVERLESS_APM_TRACE.filter(traceElement => traceElement.type === 'START_TRANSACTION')[0]
    const endTransactionElement = SERVERLESS_APM_TRACE.filter(traceElement => traceElement.type === 'END_TRANSACTION')[0]

    // Publish this trace to the SQS Queue
    try {
        const result = await publishToSqs({
            transactionId: startTransactionElement.id,
            accountId: SERVERLESS_APM_ACCOUNT_ID,
            applicationName: SERVERLESS_APM_APPLICATION_NAME,
            tierName: SERVERLESS_APM_TIER_NAME,
            componentName: SERVERLESS_APM_COMPONENT_NAME,
            transactionName: startTransactionElement.name,
            elapsedTime: endTransactionElement.elapsedTime,
            trace: [...SERVERLESS_APM_TRACE]
        })
        console.log(`Published trace to SQS: ${result.MessageId}`)
    } catch (err) {
        console.log(`An error occurred publishing trace to SQS: ${JSON.stringify(err)}`)
    }

    // Reset the inflight trace
    SERVERLESS_APM_TRACE.length = 0
}

const wrapServerResponse = (res, transactionName, startTime, tierName, componentName) => {
    console.log(`Transaction: ${transactionName}, startTime: ${startTime}`)
    return new Proxy(res, {
        apply(target, thisArg, args) {
            return res.apply(target, args)
        },
        get(target, propKey) {
            const value = target[propKey]

            if (!value) {
                return
            } else if (typeof value === 'function') {
                //
                // A method has been invoked on the ServerResponse, so end the transaction
                //
                console.log(`ServerResponse::${propKey}, transactionName=${transactionName}, startTime=${startTime}`)
                const endTime = new Date().getTime()
                const endTransactionRecord = {
                    name: transactionName,
                    type: 'END_TRANSACTION',
                    transactionStatus: 'SUCCESS',
                    time: endTime,
                    elapsedTime: endTime - startTime
                }

                if (tierName) {
                    endTransactionRecord.tierName = tierName
                }
                if (componentName) {
                    endTransactionRecord.componentName = componentName
                }

                SERVERLESS_APM_TRACE.push(endTransactionRecord)

                // Complete the trace

                // DIFFERENT THINGS THAT I TRIED THAT ALL DID NOTHING
                // completeTrace()

                // completeTrace()
                //     .then(data => {
                //         console.log('Message published to SQS')
                //     })
                //     .catch(err => console.log(`An error occurred publishing message to SQS: ${JSON.stringify(err)}`))

                // return async (...args) => {
                //     await completeTrace()
                //     const result = value.apply(res, args)
                //     return result
                // }

                // This is what I want to complete before returning the status function back to the server.js GET /user/:id handler
                Promise.resolve(completeTrace())
                    .then(() => console.log('completeTrace resolved'))

                // This is the res.status() function that starts the process of returning a result back to the caller
                return (...args) => {
                    const result = value.apply(res, args)
                    return result
                }
            } else {
                return value
            }
        }
    })
}

const wrap = (obj, tierName, componentName) => {
    return new Proxy(obj, {
        apply(target, thisArg, args) {
            // the GET function is executed
            const startTime = new Date().getTime()
            const isTransactionFunction = args.length > 0 && args[0].method && args[0].originalUrl
            let transactionName = ''
            if (isTransactionFunction) {
                console.log('This is assumed to be an express handler')
                transactionName = `${args[0].method} ${args[0].route.path}`

                // TODO: See if there is transaction id defined in the header, such as sent from the browser
                const transactionId = uuid()
                const startTransactionRecord = {
                    id: transactionId,
                    name: transactionName,
                    type: 'START_TRANSACTION',
                    time: startTime
                }

                // Add the tier and component names if they are present
                if (tierName) startTransactionRecord.tierName = tierName
                if (componentName) startTransactionRecord.componentName = componentName

                // Start this transaction
                SERVERLESS_APM_TRACE.push(startTransactionRecord)
            }

            // Execute the function
            if (args.length > 2) {
                // Here is my hook to wrap the ServerResponse in a proxy function so that I can intercept its calls
                args[1] = wrapServerResponse(args[1], transactionName, startTime, tierName, componentName)
            }
            const result = obj.apply(target, args)

            // If it is a Promise then add our own resolve/reject Promise around it so that we can capture the transaction response time
            if (isPromise(result)) {
                console.log('Function Returned a Promise')
                return new Promise(async (resolve, reject) => {
                    try {
                        const promiseResult = await result

                        // ORIGINALLY I COMPLETED THE TRANSACTION HERE, WHICH WORKS IN AN EXPRESS APP, BUT NOT IN LAMBDA
                        // BECAUSE THE RESPONSE IS SENT BACK TO THE BROWSER BEFORE THIS CAN COMPLETE

                        // const endTime = new Date().getTime()
                        // if (isTransactionFunction) {
                        //     const endTransactionRecord = {
                        //         name: transactionName,
                        //         type: 'END_TRANSACTION',
                        //         transactionStatus: 'SUCCESS',
                        //         time: endTime,
                        //         elapsedTime: endTime - startTime
                        //     }
                        //
                        //     if (tierName) {
                        //         endTransactionRecord.tierName = tierName
                        //     }
                        //     if (componentName) {
                        //         endTransactionRecord.componentName = componentName
                        //     }
                        //
                        //     SERVERLESS_APM_TRACE.push(endTransactionRecord)
                        // }
                        // // Complete the trace
                        // await completeTrace()

                        // Resolve this promise with the result of the wrapped promise
                        console.log('Resolving function\'s returned promise')
                        resolve(promiseResult)
                    } catch (err) {
                        const endTime = new Date().getTime()
                        if (isTransactionFunction) {
                            const endTransactionRecord = {
                                name: transactionName,
                                type: 'END_TRANSACTION',
                                transactionStatus: 'FAILURE',
                                time: endTime,
                                elapsedTime: endTime - startTime
                            }

                            if (tierName) endTransactionRecord.tierName = tierName
                            if (componentName) endTransactionRecord.componentName = componentName


                            SERVERLESS_APM_TRACE.push(endTransactionRecord)
                        }
                        // Complete the trace
                        await completeTrace()

                        // Reject the promise as a failure
                        reject(err)
                    }

                })
            } else {

                // Record the end the function execution
                const endTime = new Date().getTime()
                if (isTransactionFunction) {
                    const endTransactionRecord = {
                        name: transactionName,
                        type: 'END_TRANSACTION',
                        time: endTime,
                        elapsedTime: endTime - startTime
                    }

                    if (tierName) {
                        endTransactionRecord.tierName = tierName
                    }

                    SERVERLESS_APM_TRACE.push(endTransactionRecord)
                }

                // Complete the trace
                completeTrace()

                // Return the result back to the caller
                return result
            }
        },
        get(target, propKey) {
            // Retrieve the value of the property from the target
            const value = target[propKey]

            if (!value) {
                // If there is no value we can return
                return
            } else if (typeof value === 'function') {
                // If the value is a function then we need to return a function that will execute it with our timer
                return (...args) => {
                    //
                    // Handle the express class specially
                    //
                    if (obj.constructor.name === 'EventEmitter') {
                        // This is the express app - handle its methods specifically
                        if (propKey === 'get' || propKey === 'post' || propKey === 'put' || propKey === 'patch' || propKey === 'delete') {
                            // args[1] contains the function that handles the request, so wrap it in a proxy here
                            args[1] = wrap(args[1])
                            return value.apply(obj, args)
                        }

                        // This is the express app, we only care about get/post/put/delete
                        return value.apply(obj, args)
                    }

                    //
                    // Handle all other classes normally
                    //
                    console.log(`Starting function: ${propKey.toString()}`)


                    // Record the start time of the function
                    const startTime = new Date().getTime()
                    const startMethodRecord = {
                        name: propKey.toString(),
                        type: 'METHOD_START',
                        time: startTime
                    }
                    if (tierName) startMethodRecord.tierName = tierName
                    if (componentName) startMethodRecord.componentName = componentName
                    SERVERLESS_APM_TRACE.push(startMethodRecord)

                    // Execute the function
                    const result = value.apply(obj, args)

                    // Handle the result if it is a promise
                    if (isPromise(result)) {
                        console.log('The result of this function is a Promise')
                        return new Promise(async (resolve, reject) => {
                            try {
                                // Execute the promise
                                const promiseResult = await result

                                // Record the end time of the function
                                const endTime = new Date().getTime()
                                const endMethodRecord = {
                                    name: propKey.toString(),
                                    type: 'METHOD_END',
                                    time: endTime,
                                    elapsedTime: endTime - startTime
                                }
                                if (tierName) endMethodRecord.tierName = tierName
                                if (componentName) endMethodRecord.componentName = componentName
                                SERVERLESS_APM_TRACE.push(endMethodRecord)

                                // Resolve this promise with the result of the wrapped promise
                                resolve(promiseResult)
                            } catch (err) {
                                reject(err)
                            }
                        })
                    } else {
                        // Record the end time of the function
                        const endTime = new Date().getTime()
                        const endMethodRecord = {
                            name: propKey.toString(),
                            type: 'METHOD_END',
                            time: endTime,
                            elapsedTime: endTime - startTime
                        }
                        if (tierName) endMethodRecord.tierName = tierName
                        if (componentName) endMethodRecord.componentName = componentName
                        SERVERLESS_APM_TRACE.push(endMethodRecord)
                    }

                    // Return the result of the execution back to the caller
                    return result
                }
            } else if (typeof value === 'object') {
                // If this is a sub object, wrap it
                return wrap(value)
            } else {
                // If there is a value and it is not a function then return it to the caller (this is probably a property)
                return value
            }
        }
    })
}

module.exports = wrap