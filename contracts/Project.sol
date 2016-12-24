pragma solidity ^0.4.6;

contract Project {
    address public owner;

    address public project_address;
    address public contributor_address;
    uint256 public project_balance;
    uint256 public contribution_amount;

    address public proj_owner;
    uint256 public proj_goal;
    uint256 public proj_raised;
    uint256 public proj_balance;
    uint public proj_deadline;
    bool public proj_active;
    
    // create mapping
    mapping(address => projectContributors) public contributors;
    
    // struct to store info about contributors
    struct projectContributors {
        address contributor;
        uint256 contribution;
    }
    
    // constructor
    function Project(address project_owner, uint256 project_goal, uint project_deadline) {
        owner = msg.sender;
        proj_owner = project_owner;
        proj_goal = project_goal;
        proj_raised = 0;
        proj_deadline = project_deadline;
        proj_active = true;
    }
    
    // events
    event payoutEvent(address proj_owner, uint256 proj_balance);
    event refundEvent(address contributor_address, uint256 contribution_amount);
    event doPayoutEvent(address proj_owner, uint256 proj_balance);
    event doDeadlineEvent(address contributor_address, uint256 contribution_amount);
    event doContributionEvent(uint256 proj_balance);
    event successEvent(bool);
    event errorEvent(bool);
    event projectStatus(bool);

    // only if owner
    modifier onlyOwner() { if (msg.sender == owner) _; }

    // after deadline or goal reached
    modifier doRefund() { 
        if (proj_active == false) _;
        if (now >= proj_deadline) _;
        if (proj_raised >= proj_goal) _;
    }

    // goal reached
    modifier doPayout() {
        if (proj_raised >= proj_goal) _;
    }
    
    function fund(address contributor_address, uint256 contribution_amount) {
        proj_raised += contribution_amount;
        if (proj_active == true) {
            if (now >= proj_deadline) {
                doDeadlineEvent(contributor_address, contribution_amount);
                refund(contributor_address, contribution_amount);
            }
            if (proj_raised >= proj_goal) {
                doPayoutEvent(proj_owner, proj_raised);
                payout(proj_owner, proj_raised);
            }
            if ((now < proj_deadline) && (proj_raised < proj_goal)) {
                doContributionEvent(proj_raised);
                contributors[contributor_address].contributor = contributor_address;
                contributors[contributor_address].contribution += contribution_amount;
            }
        }
        else {
            projectStatus(true);
            refund(contributor_address, contribution_amount);
        }
    }
    
    // sends project balance funds to project owner
    function payout(address proj_owner, uint256 proj_raised) doPayout {
        //project_address = _project_addr;
        //project_balance = _project_balance;
        //project_balance = _project_balance * 1 ether;
        payoutEvent(proj_owner, proj_raised);
        if (proj_owner.call.gas(500000).value(proj_raised)()) {
            successEvent(true);
            proj_active = false;
        }
        else {
            errorEvent(true);
        }
    }
    
    // refund
    function refund(address contributor_address, uint256 contribution_amount) doRefund {
        //contributor_address = _contributor_addr;
        //contribution_amount = _contribution_amount;
        //contribution_amount = _contribution_amount * 1 ether;
        refundEvent(contributor_address, contribution_amount);
        if (contributor_address.call.gas(500000).value(contribution_amount)()) {
            successEvent(true);
            proj_active = false;
        }
        else {
            errorEvent(true);
        }
    }
    
    function getContributions(address contributor) returns(address, uint256) {
        return (contributors[contributor].contributor,contributors[contributor].contribution);
    }

    function getProject() returns(address, uint256, uint256, uint, bool) {
        //address proj_owner1 = proj_owner;
        return (proj_owner, proj_goal, proj_raised, proj_deadline, proj_active);
    }

    function () payable {
        if (msg.value > 0) {
            //contribution_amount = msg.value;
            //contributor_address = msg.sender;

            //proj_balance += contribution_amount;
        }
    }

    function killer() onlyOwner {
        suicide(owner);
    }
    
}