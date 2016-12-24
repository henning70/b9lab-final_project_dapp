pragma solidity ^0.4.6;

import "Project.sol";

contract FundingHub {
    address public owner;
    Project public funding_project_address;
    
    uint project_id;
    uint funding_project_deadline;
    uint256 funding_project_goal;

    // vars to resolve stack too deep issues
    uint funding_project_id;
    address funding_project_contributor;
    uint256 funding_project_contribution;
    
    // constructor
    function FundingHub() {
        owner = msg.sender;
    }

    // only if owner
    modifier onlyOwner() { if (msg.sender == owner) _; }
    
    // events
    event proj_created_event(address funding_project_owner, address funding_project_address, uint256 funding_project_goal, uint funding_project_deadline);
    event proj_contribution_event(address funding_project_contributor, address project, uint256 funding_project_contribution);
    
    // mapping
    mapping(uint => projectDB) public projects;
    //mapping(uint => projectState) public project_state;
    
    // struct
    struct projectDB {
        uint project_id;
        address project_owner;
        address project_address;
        uint256 project_goal;
        uint256 project_balance;
        uint project_deadline;
    }
    //struct projectState {
    //    uint project_id;
    //    bytes project_status;
    //}
    
    // function to create a new funding project
    function createProject(uint256 funding_project_goal, uint funding_project_deadline) returns(address, uint256, uint) {
        //funding_project_address = new Project();
        
        uint funding_project_id = project_id++;
        
        // add project info to struct
        projects[project_id].project_id = funding_project_id;
        projects[project_id].project_owner = msg.sender;
        projects[project_id].project_goal = funding_project_goal;
        projects[project_id].project_balance = 0;
        projects[project_id].project_deadline = funding_project_deadline;

        //project_state[project_id].project_id = funding_project_id;
        //project_state[project_id].project_status = "yes";

        funding_project_address = new Project(msg.sender, funding_project_goal, funding_project_deadline);
        if (funding_project_address.call.gas(1000000).value(500000000000000000)()) { } // hhhmmmmm, not working
        projects[project_id].project_address = funding_project_address;
        
        proj_created_event(msg.sender, funding_project_address, funding_project_goal, funding_project_deadline);
        
        return (funding_project_address, funding_project_goal, funding_project_deadline);
    }
    
    function getProjectCount() returns (uint) {
        return project_id;
    }
    
    // get current contract info
    function getProjectDetails(uint funding_project_id) returns(address, address, uint256, uint256, uint/*, bytes*/) {
        address project_owner = projects[funding_project_id].project_owner;
        address project_address = projects[funding_project_id].project_address;
        uint256 project_goal = projects[funding_project_id].project_goal;
        uint256 project_balance = projects[funding_project_id].project_balance;
        uint project_deadline = projects[funding_project_id].project_deadline;
        //bytes project_status = project_state[project_id].project_status;
        
        return (project_owner, project_address, project_goal, project_balance, project_deadline/*, project_status*/);
    }

    function setProjectStatus(uint funding_project_id, bool project_active) returns(bool) {
        //projects[funding_project_id].project_active = project_active;
        return true;
    }
    
    // input: funding_project_contributor addr, project number, funding_project_contribution amount
    //function contribute(uint _funding_project_id, address _contributor, uint256 _contribution) returns(address, address, uint256, uint256, uint256) {
    function contribute(uint _funding_project_id, address _contributor, uint256 _contribution) returns(address, address, uint256, uint256, uint256) {
        funding_project_id = _funding_project_id;
        funding_project_contributor = _contributor;
        funding_project_contribution = _contribution;

        projects[funding_project_id].project_balance += funding_project_contribution;
        address project_owner = projects[funding_project_id].project_owner;
        address project_address = projects[funding_project_id].project_address;
        uint256 project_balance = projects[funding_project_id].project_balance;
        uint256 project_goal = projects[funding_project_id].project_goal;
        uint funding_project_deadline = projects[funding_project_id].project_deadline;
        funding_project_address = Project(project_address);
        
        proj_contribution_event(funding_project_contributor, project_address, funding_project_contribution);
        
        //funding_project_address.fund(funding_project_id, project_owner, funding_project_contributor, project_address, funding_project_contribution, project_balance, project_goal, funding_project_deadline);
        funding_project_address.fund(funding_project_contributor, funding_project_contribution);
        
        return (funding_project_contributor, project_address, funding_project_contribution, project_balance, project_goal);
    }

    function () payable {
        if (msg.value > 0) {
            var amount = msg.value;
            var sender = msg.sender;
        }
    }

    function killer() onlyOwner {
        suicide(owner);
    }
    
}