### Final Project - Funding Hub

Using browser-solidity the contracts worked as expected. From the DAPP most features work as expected but sometimes not quite. 

**Still to add / issues / vulnerabilities:**
- Balance checking of contributors
- Unlocking accounts not included in code yet (for dev/test i unlock all accounts upon geth startup)
- Some erratic behaviour with my if statements in Projects.sol

I'm sure that there are easier more effective ways in coding a funding hub DAPP but I implemented the required functions as explained for the final project.

**The contracts:**

*FundingHub.sol*

In addition to the required *createProject()* function and *contribute()* function I added a number of other functions.
* createProject(uint256 funding_project_goal, uint funding_project_deadline)
	
  This function will create (deploy) a new *Project* contract 
* contribute(uint _funding_project_id, address _contributor, uint256 _contribution)
  
  This function will call the *fund()* function of the *Project* contract for which the contribution is targeted at.
* getProjectCount()

  This function will get the number of deployed *Project* contracts
* getProjectDetails(uint funding_project_id)

  This function will get information about a specific *Project* contract

The contract also has a struct to store information about created projects to keep track of for instance a projects address. I only later realised/remembered that the *Project* contract should keep track of the projects owner, goal, deadline etc. and updated the *Project* contract to do so. I have not yet removed this functionality from the *FundingHub* contract as I found it handy during my development.

The contract also has a number of defined events and a modifier to ensure only the owner can call suicide on the contract.


*Project.sol*

In addition to the required *fund()*, *payout* and *refund* functions the contract also contains some other functions.

This contracts *constructore* contains all needed information to keep track of the *owner*, *goal*, *balance*, *deadline* and *status* of the project.

* fund(address contributor_address, uint256 contribution_amount)

* payout(address proj_owner, uint256 proj_raised) doPayout

  This function will ensure that the raised funds get paid to the owner of the project
* refund(address contributor_address, uint256 contribution_amount) doRefund

  This function will ensure refunds are done when the deadline has been reached or goal has been reached
* getContributions(address contributor)

  This function will get information about a specific contributor. (not used anymore)
* getProject()

  This function will retrieve all information of the project. This information include: owner, goal, raised, deadline and status

The *status* is used to check if the project is active or not. The project gets a status of *Ended* if either the deadline has been passed or the goal has been reached.

The contract also has a number of defined events and modifiers.

The contract is far from perfect but does seem to do what it is suppose to do.

**The migration script:**

*2_deploy_contracts.js*

I could have opted for a seperate migrations script but decided to modify this script too suit my needs. The migration script, will first deploy the *Projects* contract. It will then deploy the *FundingHub* contract and once completed create a new *Project* contract using the *createProject()* function from the deployed *FundingHub*. Once the new *Project* contract has been deployed, the *getProjectDetails()* function from the deployed *FundingHub* will be called to retrieve information of the newly deployed *Project* contract and then send some wei to the *Project* contract.

**The test**

*test_refund.js*

I wrote a test which is not 100% completed due to time constraints. I was also hampered by timeouts on *testnet*. Using *testrpc* did not help either as it continuously gave me *out of gas* errors. Using my *private net* I had more luck with the test but just ran out of time to get the *refund* check done.

**The interface:**

The inerface consists of three parts, *Create project*; *Contribute* and *Project details*.

*Create project:*

Consists of 4 fields and a button.

The *Project owner* field is a drop down list of all accounts discovered from the local running geth instance. Handy for dev/test, but for production use will be a input field.

The *Balance* field is an input field which will automatically be populated with the selected project owner's account balance.

The *Goal* field is an input field where the amount of wei can be entered which will represent the amount of funds the project is required to raise.

The *Deadline* field is an input field where the date/time by which the goal should have been reached can be entered in the format, *yyyy-mm-dd HH:MM:SS.sss*. The DAPP *app.js* will convert the value to epoch which is required to compare against the current block timestamp (now) to see if the deadline of the project has passed or not.

The *Create project* button will initiate project creation.


*Contribute:*

Consists of 4 fields and a button.

The *From* field is a drop down list of all accounts discovered from the local running geth instance. Handy for dev/test, but for production use will be a input field. This will be the contributors address.

The *Balance* field is an input field which will automatically be populated with the selected contributors account balance.

The *To* field is the address of the project the contributor wants to send his contribution to. The *Project details* field contains the address of the available projects and can for now be copied from there into this field.

The *Amount* field is an input field where the amount of wei can be entered which will represent the amount the contributor wants to contribute to the project.

The *Contribute* button will initiate the contribution.


*Project details:*

This section contains all information about a specific project. The *ID* drop down list can be used to select a project. A proper web interface will display the available projects in for instance a grid format for easy selection. 

This section displays the following information about a selected project:
Owner, Address, Balance, Goal, Raised, Deadline and Status

Selecting an *ID* will automaticall populate all the fields by calling the *_getProject()* function in the DAPP *app.js*.

The *Project details* button can also be used to retrieve updated information about the selected project. Not really required as the fields are updated automatically after doing a contribution for instance.



