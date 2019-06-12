const express = require('express')
const agent = require('./agent')
const asyncHandler = require('express-async-handler')
const repository = agent(require('./repository'), 'DynamoDB', 'UserRepository')

const app = agent(express())
const port = 3000

app.get('/user/:id', asyncHandler(async (req, res) => {
    try {
        // Get a user
        let user = await repository.findById(req.params.id)
        console.log(`User: ${user}`)

        // Another method that will take a little while to complete
        let otherUser = await repository.doSomethingElse(req.params.id)

        // Build the response
        res.status(200)
            .set({'Location': `/user/${user.id}`, 'ETag': user.version})
            .json(user)

    } catch (err) {
        // An error occurred, return a 404 Not Found
        console.log('Error: ' + JSON.stringify(err, null, 2))
        res.status(404).end()
    }
}))

app.listen(port, () => console.log(`Example app listening on port ${port}!`))